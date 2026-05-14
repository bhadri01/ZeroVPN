//! Per-user, account-security-relevant event log. See
//! `migrations/00000000000017_session_events.sql` for the table comment
//! and the rationale for why this table coexists with `audit_logs`.

use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::PgPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "session_event_kind", rename_all = "snake_case")]
pub enum SessionEvent {
    Login,
    Logout,
    IdleTimeout,
    SuspiciousLogin,
    PasswordChange,
    TotpEnable,
    TotpDisable,
    ImpersonationStart,
    ImpersonationEnd,
}

/// Insert a single session_events row. Best-effort: a transient DB
/// error here must NOT block the underlying auth/admin handler — every
/// call site logs + drops. The audit log already captured the action
/// (these handlers all sit next to an `audit::record(...)`), so the
/// session_events miss is recoverable from the audit row if needed.
pub async fn record(
    pool: &PgPool,
    user_id: Uuid,
    event: SessionEvent,
    ip: Option<IpNetwork>,
    user_agent: Option<&str>,
    metadata: Value,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO session_events (user_id, event, ip, user_agent, metadata)
           VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(user_id)
    .bind(event)
    .bind(ip)
    .bind(user_agent)
    .bind(metadata)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct SessionEventRow {
    pub id: i64,
    pub user_id: Uuid,
    pub event: SessionEvent,
    /// Full client IP. Serialised as a string for OpenAPI consumers.
    #[schema(value_type = Option<String>, example = "203.0.113.42/32")]
    pub ip: Option<IpNetwork>,
    pub user_agent: Option<String>,
    pub metadata: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// Filters for the admin listing. All optional; NULL disables the
/// corresponding WHERE clause via the `$N::TYPE IS NULL OR ...`
/// idiom (matches the audit-log pattern).
#[derive(Debug, Default, Clone, Copy)]
pub struct Filters<'a> {
    pub user_id: Option<Uuid>,
    pub event: Option<SessionEvent>,
    pub ip: Option<&'a str>,
    pub since: Option<OffsetDateTime>,
    pub until: Option<OffsetDateTime>,
}

pub async fn list_recent(
    pool: &PgPool,
    f: Filters<'_>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<SessionEventRow>> {
    let limit = limit.clamp(1, 500);
    let offset = offset.max(0);
    sqlx::query_as::<_, SessionEventRow>(
        // Note `ip = $5::INET` — without the explicit cast on BOTH
        // usages of $5, Postgres binds the parameter as TEXT (sqlx's
        // mapping for `Option<&str>`) and the prepare step fails with
        // `operator does not exist: inet = text`, even though the
        // `$5::INET IS NULL` guard would short-circuit at runtime.
        r#"SELECT id, user_id, event, ip, user_agent, metadata, created_at
             FROM session_events
            WHERE ($3::UUID                 IS NULL OR user_id = $3)
              AND ($4::session_event_kind   IS NULL OR event   = $4)
              AND ($5::INET                 IS NULL OR ip      = $5::INET)
              AND ($6::TIMESTAMPTZ          IS NULL OR created_at >= $6)
              AND ($7::TIMESTAMPTZ          IS NULL OR created_at <  $7)
            ORDER BY id DESC
            LIMIT $1 OFFSET $2"#,
    )
    .bind(limit)
    .bind(offset)
    .bind(f.user_id)
    .bind(f.event)
    .bind(f.ip)
    .bind(f.since)
    .bind(f.until)
    .fetch_all(pool)
    .await
}

pub async fn count_recent(pool: &PgPool, f: Filters<'_>) -> sqlx::Result<i64> {
    let row: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*)::BIGINT FROM session_events
            WHERE ($1::UUID                 IS NULL OR user_id = $1)
              AND ($2::session_event_kind   IS NULL OR event   = $2)
              AND ($3::INET                 IS NULL OR ip      = $3::INET)
              AND ($4::TIMESTAMPTZ          IS NULL OR created_at >= $4)
              AND ($5::TIMESTAMPTZ          IS NULL OR created_at <  $5)"#,
    )
    .bind(f.user_id)
    .bind(f.event)
    .bind(f.ip)
    .bind(f.since)
    .bind(f.until)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}
