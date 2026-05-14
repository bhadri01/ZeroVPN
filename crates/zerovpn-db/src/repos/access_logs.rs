//! Per-request HTTP access log. Populated by the
//! `access_log` middleware in zerovpn-api; admin surface is
//! `/admin/access-logs`. See migration 19 for schema + retention
//! posture.

use ipnetwork::IpNetwork;
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::PgPool;

/// Shape passed by the middleware into `record`. References borrow
/// from the response/request so we don't allocate when the eventual
/// tokio::spawn moves the values. The Rust-side struct keeps the
/// column names verbatim because the middleware constructs one of
/// these per request and dropping a field would be silent.
pub struct AccessLogEntry<'a> {
    pub user_id: Option<Uuid>,
    pub method: &'a str,
    pub path: &'a str,
    pub status: i16,
    pub latency_ms: i32,
    pub ip: Option<IpNetwork>,
    pub user_agent: Option<&'a str>,
    pub request_id: Option<&'a str>,
}

/// Insert one row. Best-effort — the middleware tokio::spawns this and
/// logs the error on failure; the HTTP response has already been sent.
pub async fn record(pool: &PgPool, e: AccessLogEntry<'_>) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO access_logs
              (user_id, method, path, status, latency_ms, ip, user_agent, request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
    )
    .bind(e.user_id)
    .bind(e.method)
    .bind(e.path)
    .bind(e.status)
    .bind(e.latency_ms)
    .bind(e.ip)
    .bind(e.user_agent)
    .bind(e.request_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct AccessLogRow {
    pub id: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub user_id: Option<Uuid>,
    pub method: String,
    pub path: String,
    pub status: i16,
    pub latency_ms: i32,
    #[schema(value_type = Option<String>, example = "203.0.113.42/32")]
    pub ip: Option<IpNetwork>,
    pub user_agent: Option<String>,
    pub request_id: Option<String>,
}

/// Filter shape for the admin list. `path` does a prefix match
/// (`LIKE 'foo%'`); the rest are exact filters.
#[derive(Debug, Default, Clone, Copy)]
pub struct Filters<'a> {
    pub user_id: Option<Uuid>,
    pub method: Option<&'a str>,
    pub path_prefix: Option<&'a str>,
    pub status_min: Option<i16>,
    pub status_max: Option<i16>,
    pub ip: Option<&'a str>,
    pub since: Option<OffsetDateTime>,
    pub until: Option<OffsetDateTime>,
}

pub async fn list_recent(
    pool: &PgPool,
    f: Filters<'_>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<AccessLogRow>> {
    let limit = limit.clamp(1, 500);
    let offset = offset.max(0);
    // Prefix matching is built server-side rather than the caller doing
    // `LIKE` escaping: the path column doesn't contain `%` or `_`
    // characters that would mangle a string concat.
    let path_pat = f.path_prefix.map(|p| format!("{p}%"));
    sqlx::query_as::<_, AccessLogRow>(
        // `ip = $8::INET` — see session_events.rs for the rationale;
        // sqlx binds `Option<&str>` as TEXT and Postgres rejects
        // `INET = TEXT` at prepare time without the explicit cast.
        r#"SELECT id, created_at, user_id, method, path, status, latency_ms,
                  ip, user_agent, request_id
             FROM access_logs
            WHERE ($3::UUID        IS NULL OR user_id = $3)
              AND ($4::TEXT        IS NULL OR method  = $4)
              AND ($5::TEXT        IS NULL OR path LIKE $5)
              AND ($6::SMALLINT    IS NULL OR status >= $6)
              AND ($7::SMALLINT    IS NULL OR status <= $7)
              AND ($8::INET        IS NULL OR ip      = $8::INET)
              AND ($9::TIMESTAMPTZ IS NULL OR created_at >= $9)
              AND ($10::TIMESTAMPTZ IS NULL OR created_at <  $10)
            ORDER BY created_at DESC, id DESC
            LIMIT $1 OFFSET $2"#,
    )
    .bind(limit)
    .bind(offset)
    .bind(f.user_id)
    .bind(f.method)
    .bind(path_pat.as_deref())
    .bind(f.status_min)
    .bind(f.status_max)
    .bind(f.ip)
    .bind(f.since)
    .bind(f.until)
    .fetch_all(pool)
    .await
}

pub async fn count_recent(pool: &PgPool, f: Filters<'_>) -> sqlx::Result<i64> {
    let path_pat = f.path_prefix.map(|p| format!("{p}%"));
    let row: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*)::BIGINT FROM access_logs
            WHERE ($1::UUID        IS NULL OR user_id = $1)
              AND ($2::TEXT        IS NULL OR method  = $2)
              AND ($3::TEXT        IS NULL OR path LIKE $3)
              AND ($4::SMALLINT    IS NULL OR status >= $4)
              AND ($5::SMALLINT    IS NULL OR status <= $5)
              AND ($6::INET        IS NULL OR ip      = $6::INET)
              AND ($7::TIMESTAMPTZ IS NULL OR created_at >= $7)
              AND ($8::TIMESTAMPTZ IS NULL OR created_at <  $8)"#,
    )
    .bind(f.user_id)
    .bind(f.method)
    .bind(path_pat.as_deref())
    .bind(f.status_min)
    .bind(f.status_max)
    .bind(f.ip)
    .bind(f.since)
    .bind(f.until)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}
