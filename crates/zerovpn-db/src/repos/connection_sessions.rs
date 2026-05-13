//! Per-device WireGuard connection sessions. See
//! `migrations/00000000000018_connection_sessions.sql` for the schema
//! comment and the lifecycle.
//!
//! Three call sites in the worker:
//!   - [`open`]            — wg_poller transition offline → online (or
//!                            None → online on the first observation
//!                            after worker boot).
//!   - [`close`]           — wg_poller transition online → offline.
//!   - [`close_all_open`]  — worker startup; the in-memory `prev_online`
//!                            map and the captured WG counters are
//!                            gone, so any rows still flagged open are
//!                            stale and get marked closed with
//!                            `ended_at = NOW()` (the byte_end columns
//!                            stay NULL — they're meaningless without
//!                            a new observation to anchor against).

use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::PgPool;

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ConnectionSessionRow {
    pub id: i64,
    pub device_id: Uuid,
    pub user_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub ended_at: Option<OffsetDateTime>,
    pub peer_endpoint_at_start: Option<String>,
    pub peer_endpoint_at_end: Option<String>,
    pub rx_bytes_at_start: i64,
    pub tx_bytes_at_start: i64,
    pub rx_bytes_at_end: Option<i64>,
    pub tx_bytes_at_end: Option<i64>,
}

/// Insert a new open session row (online transition). Returns the row
/// id so the caller could correlate later — none of the current call
/// sites need the id, but it's cheap to surface. Best-effort at the
/// caller: a transient DB error here doesn't block the live stats
/// stream.
pub async fn open(
    pool: &PgPool,
    device_id: Uuid,
    user_id: Uuid,
    peer_endpoint: Option<&str>,
    rx_bytes: i64,
    tx_bytes: i64,
    started_at: OffsetDateTime,
) -> sqlx::Result<i64> {
    let row: (i64,) = sqlx::query_as(
        r#"INSERT INTO connection_sessions
              (device_id, user_id, peer_endpoint_at_start,
               rx_bytes_at_start, tx_bytes_at_start, started_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id"#,
    )
    .bind(device_id)
    .bind(user_id)
    .bind(peer_endpoint)
    .bind(rx_bytes)
    .bind(tx_bytes)
    .bind(started_at)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

/// Close the device's most recent open session (offline transition).
/// Returns the id of the row that was closed, or `None` if no open
/// session existed for that device — the offline transition is then a
/// no-op, which can happen if the worker restarted between the
/// previous online observation and this one (the startup sweep
/// pre-closed everything).
pub async fn close(
    pool: &PgPool,
    device_id: Uuid,
    peer_endpoint: Option<&str>,
    rx_bytes: i64,
    tx_bytes: i64,
    ended_at: OffsetDateTime,
) -> sqlx::Result<Option<i64>> {
    // CTE locates the latest open row for the device and feeds its id
    // into a single UPDATE — atomic on Postgres MVCC, no need for an
    // explicit transaction.
    let row: Option<(i64,)> = sqlx::query_as(
        r#"WITH target AS (
              SELECT id FROM connection_sessions
               WHERE device_id = $1 AND ended_at IS NULL
               ORDER BY started_at DESC
               LIMIT 1
           )
           UPDATE connection_sessions cs
              SET ended_at              = $2,
                  peer_endpoint_at_end  = $3,
                  rx_bytes_at_end       = $4,
                  tx_bytes_at_end       = $5
             FROM target
            WHERE cs.id = target.id
           RETURNING cs.id"#,
    )
    .bind(device_id)
    .bind(ended_at)
    .bind(peer_endpoint)
    .bind(rx_bytes)
    .bind(tx_bytes)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id,)| id))
}

/// Worker-startup sweep. Closes every open session by stamping
/// `ended_at = NOW()` and leaving the end-state byte counters NULL.
/// Returns the row count for tracing.
pub async fn close_all_open(pool: &PgPool) -> sqlx::Result<u64> {
    let res = sqlx::query(
        r#"UPDATE connection_sessions
              SET ended_at = NOW()
            WHERE ended_at IS NULL"#,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Per-device timeline, newest first. Admin connection-history dialog.
/// `limit` is hard-capped at 500 to keep the response payload bounded.
pub async fn list_for_device(
    pool: &PgPool,
    device_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<ConnectionSessionRow>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, ConnectionSessionRow>(
        r#"SELECT id, device_id, user_id, started_at, ended_at,
                  peer_endpoint_at_start, peer_endpoint_at_end,
                  rx_bytes_at_start, tx_bytes_at_start,
                  rx_bytes_at_end, tx_bytes_at_end
             FROM connection_sessions
            WHERE device_id = $1
            ORDER BY started_at DESC, id DESC
            LIMIT $2"#,
    )
    .bind(device_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Cross-device timeline scoped to a single user. Powers the per-user
/// admin activity timeline. Newest first; `limit` clamped at 500.
pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<ConnectionSessionRow>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, ConnectionSessionRow>(
        r#"SELECT id, device_id, user_id, started_at, ended_at,
                  peer_endpoint_at_start, peer_endpoint_at_end,
                  rx_bytes_at_start, tx_bytes_at_start,
                  rx_bytes_at_end, tx_bytes_at_end
             FROM connection_sessions
            WHERE user_id = $1
            ORDER BY started_at DESC, id DESC
            LIMIT $2"#,
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}
