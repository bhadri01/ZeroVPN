//! Per-server time-series samples. Written every poll tick (default 1s)
//! by the worker. Purged after 30 days by default; set
//! `ZEROVPN_SERVER_SAMPLE_RETENTION_DAYS` (days; `0` = keep indefinitely).

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ServerSample {
    pub server_id: Uuid,
    pub sampled_at: OffsetDateTime,
    pub total_rx_bytes: i64,
    pub total_tx_bytes: i64,
    pub peer_count: i32,
    pub online_count: i32,
    pub handshake_count: i32,
}

pub async fn insert(
    pool: &PgPool,
    server_id: Uuid,
    sampled_at: OffsetDateTime,
    total_rx_bytes: i64,
    total_tx_bytes: i64,
    peer_count: i32,
    online_count: i32,
    handshake_count: i32,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO server_samples
              (server_id, sampled_at, total_rx_bytes, total_tx_bytes,
               peer_count, online_count, handshake_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (server_id, sampled_at) DO NOTHING"#,
    )
    .bind(server_id)
    .bind(sampled_at)
    .bind(total_rx_bytes)
    .bind(total_tx_bytes)
    .bind(peer_count)
    .bind(online_count)
    .bind(handshake_count)
    .execute(pool)
    .await?;
    Ok(())
}

/// Raw samples for a server between `from` and `to`. Caller is responsible
/// for bounding the window — unbounded queries against a tick-per-second
/// table are slow.
pub async fn range(
    pool: &PgPool,
    server_id: Uuid,
    from: OffsetDateTime,
    to: OffsetDateTime,
    limit: i64,
) -> sqlx::Result<Vec<ServerSample>> {
    sqlx::query_as::<_, ServerSample>(
        r#"SELECT server_id, sampled_at, total_rx_bytes, total_tx_bytes,
                  peer_count, online_count, handshake_count
             FROM server_samples
            WHERE server_id = $1 AND sampled_at >= $2 AND sampled_at < $3
            ORDER BY sampled_at ASC
            LIMIT $4"#,
    )
    .bind(server_id)
    .bind(from)
    .bind(to)
    .bind(limit)
    .fetch_all(pool)
    .await
}
