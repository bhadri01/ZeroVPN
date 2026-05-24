//! Quota-enforcement queries for the periodic sweep that runs in the API
//! (which owns the WireGuard controller). The worker only *measures* usage —
//! folding each tick into `users.current_month_bytes` / `devices
//! .current_month_bytes` — while this module finds the rows the sweep must act
//! on: windows due for reset, devices to auto-resume, and devices to auto-pause.

use ipnetwork::IpNetwork;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::PgPool;

/// A device the sweep should bring on/off the WG interface. `over_device_cap`
/// (pause rows only) is true when the device's *own* cap triggered the pause,
/// false when its owner's account cap did — used to word the notification.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuotaDevice {
    pub id: Uuid,
    pub user_id: Uuid,
    pub public_key: String,
    pub allocated_ip: IpNetwork,
    #[sqlx(default)]
    pub over_device_cap: bool,
}

/// Reset every per-user monthly counter whose window has elapsed, advancing it
/// to the next boundary. Idempotent w.r.t. the worker's inline reset: a counter
/// the worker already rolled over has `quota_resets_at` in the future and is
/// skipped here. Returns rows reset.
pub async fn reset_due_users(
    pool: &PgPool,
    now: OffsetDateTime,
    next: OffsetDateTime,
) -> sqlx::Result<u64> {
    let res = sqlx::query(
        "UPDATE users
            SET current_month_bytes = 0, quota_resets_at = $2
          WHERE quota_resets_at IS NOT NULL AND quota_resets_at < $1
            AND deleted_at IS NULL",
    )
    .bind(now)
    .bind(next)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Per-device counterpart of [`reset_due_users`].
pub async fn reset_due_devices(
    pool: &PgPool,
    now: OffsetDateTime,
    next: OffsetDateTime,
) -> sqlx::Result<u64> {
    let res = sqlx::query(
        "UPDATE devices
            SET current_month_bytes = 0, quota_resets_at = $2
          WHERE quota_resets_at IS NOT NULL AND quota_resets_at < $1",
    )
    .bind(now)
    .bind(next)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Devices the sweep previously auto-paused for quota that are now back under
/// both their own cap and their owner's account cap (e.g. after a reset). Only
/// devices owned by an active, non-deleted user are returned — a suspended
/// user's peers must stay off regardless of quota.
pub async fn resume_candidates(pool: &PgPool) -> sqlx::Result<Vec<QuotaDevice>> {
    sqlx::query_as(
        "SELECT d.id, d.user_id, d.public_key, d.allocated_ip, FALSE AS over_device_cap
           FROM devices d
           JOIN users u ON u.id = d.user_id
          WHERE d.auto_paused = TRUE
            AND d.status = 'paused'
            AND u.status = 'active'
            AND u.deleted_at IS NULL
            AND (d.monthly_byte_cap IS NULL OR d.monthly_byte_cap <= 0
                 OR d.current_month_bytes < d.monthly_byte_cap)
            AND (u.monthly_byte_cap IS NULL OR u.monthly_byte_cap <= 0
                 OR u.current_month_bytes < u.monthly_byte_cap)",
    )
    .fetch_all(pool)
    .await
}

/// Active devices over their own cap OR their owner's account cap — the sweep
/// pauses these. `over_device_cap` distinguishes the two for messaging.
pub async fn pause_candidates(pool: &PgPool) -> sqlx::Result<Vec<QuotaDevice>> {
    sqlx::query_as(
        "SELECT d.id, d.user_id, d.public_key, d.allocated_ip,
                (d.monthly_byte_cap IS NOT NULL AND d.monthly_byte_cap > 0
                 AND d.current_month_bytes >= d.monthly_byte_cap) AS over_device_cap
           FROM devices d
           JOIN users u ON u.id = d.user_id
          WHERE d.status = 'active'
            AND u.status = 'active'
            AND u.deleted_at IS NULL
            AND (
              (d.monthly_byte_cap IS NOT NULL AND d.monthly_byte_cap > 0
               AND d.current_month_bytes >= d.monthly_byte_cap)
              OR (u.monthly_byte_cap IS NOT NULL AND u.monthly_byte_cap > 0
                  AND u.current_month_bytes >= u.monthly_byte_cap)
            )",
    )
    .fetch_all(pool)
    .await
}

/// Flip a device to paused and flag it as quota-paused (so the reset sweep
/// knows it may auto-resume it, vs. a user's manual pause).
pub async fn mark_auto_paused(pool: &PgPool, device_id: Uuid) -> sqlx::Result<u64> {
    let res = sqlx::query(
        "UPDATE devices SET status = 'paused', auto_paused = TRUE
          WHERE id = $1 AND status = 'active'",
    )
    .bind(device_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Flip a quota-paused device back to active and clear the flag.
pub async fn mark_resumed(pool: &PgPool, device_id: Uuid) -> sqlx::Result<u64> {
    let res = sqlx::query(
        "UPDATE devices SET status = 'active', auto_paused = FALSE
          WHERE id = $1 AND status = 'paused' AND auto_paused = TRUE",
    )
    .bind(device_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}
