//! Retention enforcement.
//!
//! Runs every 6 hours.
//!
//! **As of Phase 2 / Stage A** ("Full logging system" policy reversal),
//! every rule that *anonymized* or *deleted* operationally-useful rows
//! has been dropped. What remains are cleanup rules for rows that are
//! purely overhead once their TTL has passed:
//!
//! - Verification tokens older than 24 h (consumed or expired) — the
//!   email link is dead, the row is just bytes.
//! - Soft-deleted users older than 30 d — cascade-removes their devices,
//!   sessions, etc., reclaiming storage.
//! - Pending-verification accounts older than 7 d — the verify-email
//!   link expired at 24 h and the row blocks the email from being
//!   re-registered.
//!
//! Notably **no longer enforced**:
//! - `audit_logs.ip_prefix` is no longer anonymized at 30 days.
//! - `failed_logins` rows are kept indefinitely.
//! - `bandwidth_samples` and `server_samples` are kept indefinitely
//!   (the env vars `ZEROVPN_SAMPLE_RETENTION_DAYS` and
//!   `ZEROVPN_SERVER_SAMPLE_RETENTION_DAYS` are no longer consulted —
//!   operator-tunable retention windows return in Stage D).

use std::time::Duration;

use time::OffsetDateTime;
use tracing::{info, warn};
use zerovpn_db::PgPool;

const TICK: Duration = Duration::from_secs(6 * 3600);
const VERIFY_TOKEN_RETENTION_HOURS: i64 = 24;
const SOFT_DELETE_PURGE_DAYS: i64 = 30;
/// Pending-verification accounts older than this are dropped outright.
/// Their verify-email TTL is 24 h, so by day 7 the link is long-dead and
/// the row is just blocking the email from being re-registered.
const PENDING_VERIFICATION_PURGE_DAYS: i64 = 7;

pub async fn run(pool: PgPool) {
    info!("retention purger started");
    // Run once on startup for fast feedback in dev.
    if let Err(e) = run_once(&pool).await {
        warn!(?e, "retention pass failed");
    }
    let mut ticker = tokio::time::interval(TICK);
    ticker.tick().await; // skip immediate
    loop {
        ticker.tick().await;
        if let Err(e) = run_once(&pool).await {
            warn!(?e, "retention pass failed");
        }
    }
}

async fn run_once(pool: &PgPool) -> sqlx::Result<()> {
    let now = OffsetDateTime::now_utc();

    // Expire consumed/expired verification tokens that are older than
    // 24 h — they no longer serve any purpose.
    let token_cutoff = now - time::Duration::hours(VERIFY_TOKEN_RETENTION_HOURS);
    let res = sqlx::query(
        "DELETE FROM verification_tokens
          WHERE (consumed_at IS NOT NULL OR expires_at < $1)
            AND created_at < $1",
    )
    .bind(token_cutoff)
    .execute(pool)
    .await?;
    if res.rows_affected() > 0 {
        info!(rows = res.rows_affected(), "purged stale verification tokens");
    }

    // Hard-purge users soft-deleted >30 days ago. Cascades remove
    // devices, sessions, api_tokens, etc.
    let purge_cutoff = now - time::Duration::days(SOFT_DELETE_PURGE_DAYS);
    let res = sqlx::query(
        "DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < $1",
    )
    .bind(purge_cutoff)
    .execute(pool)
    .await?;
    if res.rows_affected() > 0 {
        info!(rows = res.rows_affected(), "hard-purged soft-deleted users");
    }

    // Drop accounts that signed up but never clicked the verify link.
    // Once the verify token has been dead for days, the row just blocks
    // the email from being re-registered. Cascades clean up any
    // leftover verification_tokens.
    let pending_cutoff = now - time::Duration::days(PENDING_VERIFICATION_PURGE_DAYS);
    let res = sqlx::query(
        "DELETE FROM users
          WHERE status = 'pending_verification'
            AND email_verified_at IS NULL
            AND created_at < $1",
    )
    .bind(pending_cutoff)
    .execute(pool)
    .await?;
    if res.rows_affected() > 0 {
        info!(
            rows = res.rows_affected(),
            "purged stale pending-verification accounts"
        );
    }

    Ok(())
}
