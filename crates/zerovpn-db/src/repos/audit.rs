use ipnetwork::IpNetwork;
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::PgPool;

pub struct AuditEntry<'a> {
    pub actor_user_id: Option<Uuid>,
    pub action: &'a str,
    pub target_type: Option<&'a str>,
    pub target_id: Option<Uuid>,
    pub metadata: Value,
    /// Full client IP captured at the time the audit row was written.
    /// `INET` column type, `/32` (v4) or `/128` (v6) host network.
    /// Renamed from `ip_prefix` in migration 20.
    pub ip: Option<IpNetwork>,
}

/// Insert an audit row with no `user_agent` captured. Most call sites
/// don't have a `HeaderMap` in scope (worker tasks, CLI commands,
/// internal state transitions) and write `NULL` into the column. Route
/// handlers that *do* have the request headers should call
/// [`record_with_ua`] instead.
pub async fn record(pool: &PgPool, e: AuditEntry<'_>) -> sqlx::Result<()> {
    record_with_ua(pool, e, None).await
}

/// Insert an audit row with the request's `User-Agent` captured.
/// Phase 2 / Stage A — populates the new `audit_logs.user_agent`
/// column. Existing call sites continue to use [`record`] which passes
/// `None` here; flows that already have the header in scope (auth,
/// password-reset, totp, account-management) migrate over piecemeal.
pub async fn record_with_ua(
    pool: &PgPool,
    e: AuditEntry<'_>,
    user_agent: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO audit_logs
              (actor_user_id, action, target_type, target_id, metadata, ip, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(e.actor_user_id)
    .bind(e.action)
    .bind(e.target_type)
    .bind(e.target_id)
    .bind(e.metadata)
    .bind(e.ip)
    .bind(user_agent)
    .execute(pool)
    .await?;
    Ok(())
}

/// Row returned by `list_for_target`. Just the columns the device
/// timeline UI needs — ip and target_type are stripped because
/// the caller already filtered on them.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TimelineEntry {
    pub id: i64,
    pub action: String,
    pub metadata: Value,
    pub created_at: OffsetDateTime,
}

/// Fetch the most recent audit entries for a specific target (e.g. a
/// device). The caller is responsible for verifying that the calling
/// user owns the target before invoking this — the function does not
/// check authorisation on its own. Newest first; `limit` is hard-capped
/// at 500 to keep the response payload bounded.
pub async fn list_for_target(
    pool: &PgPool,
    target_type: &str,
    target_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<TimelineEntry>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, TimelineEntry>(
        r#"SELECT id, action, metadata, created_at
             FROM audit_logs
            WHERE target_type = $1 AND target_id = $2
            ORDER BY created_at DESC, id DESC
            LIMIT $3"#,
    )
    .bind(target_type)
    .bind(target_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Keyset-paginated variant of [`list_for_target`] for infinite scroll. When
/// `before_id` is `Some`, returns only entries older than that id (the cursor
/// is the last row's id from the previous page). Ordering by `id DESC` matches
/// `created_at DESC` because audit ids are assigned monotonically at insert
/// time, so the cursor stays stable even as new rows land at the top — no
/// offset drift or duplicate rows mid-scroll. `limit` is hard-capped at 500.
pub async fn list_for_target_before(
    pool: &PgPool,
    target_type: &str,
    target_id: Uuid,
    before_id: Option<i64>,
    limit: i64,
) -> sqlx::Result<Vec<TimelineEntry>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, TimelineEntry>(
        r#"SELECT id, action, metadata, created_at
             FROM audit_logs
            WHERE target_type = $1 AND target_id = $2
              AND ($3::bigint IS NULL OR id < $3)
            ORDER BY id DESC
            LIMIT $4"#,
    )
    .bind(target_type)
    .bind(target_id)
    .bind(before_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Richer row for the per-user activity timeline. Includes the IP / UA
/// captured at write time + the target so the frontend can render
/// "user X edited device Y" in one line.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserActivityEntry {
    pub id: i64,
    pub action: String,
    pub metadata: Value,
    pub ip: Option<ipnetwork::IpNetwork>,
    pub user_agent: Option<String>,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
}

/// Fetch audit entries where the user is either the *actor* (their own
/// actions: device created, password changed, login, etc.) or the
/// *target* (admin actions taken on them: status changed, role changed,
/// impersonated). Newest first; `limit` hard-capped at 500.
pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<UserActivityEntry>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, UserActivityEntry>(
        r#"SELECT id, action, metadata, ip, user_agent, target_type, target_id, created_at
             FROM audit_logs
            WHERE actor_user_id = $1
               OR (target_type = 'user' AND target_id = $1)
            ORDER BY created_at DESC, id DESC
            LIMIT $2"#,
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Offset-paginated form of [`list_for_user`] for the user-facing "Activity"
/// page. Same scope (the user as actor or as a `user`-target) and ordering;
/// pair with [`count_for_user`] for the total. `limit` hard-capped at 200.
pub async fn list_for_user_paged(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<UserActivityEntry>> {
    let limit = limit.clamp(1, 200);
    let offset = offset.max(0);
    sqlx::query_as::<_, UserActivityEntry>(
        r#"SELECT id, action, metadata, ip, user_agent, target_type, target_id, created_at
             FROM audit_logs
            WHERE actor_user_id = $1
               OR (target_type = 'user' AND target_id = $1)
            ORDER BY created_at DESC, id DESC
            LIMIT $2 OFFSET $3"#,
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

/// Total audit entries in scope for a user (same predicate as
/// [`list_for_user`]) — drives the Activity page's pagination control.
pub async fn count_for_user(pool: &PgPool, user_id: Uuid) -> sqlx::Result<i64> {
    let row: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*)::BIGINT
             FROM audit_logs
            WHERE actor_user_id = $1
               OR (target_type = 'user' AND target_id = $1)"#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}
