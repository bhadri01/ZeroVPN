use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::PgPool;

/// Append a row to `peer_endpoint_history`. Called by the WG poller
/// when a peer's `wg show dump` endpoint differs from the last
/// in-memory observation. Best-effort: a transient DB error here must
/// not stop the live stats stream, so the caller logs + drops.
pub async fn record(
    pool: &PgPool,
    device_id: Uuid,
    endpoint: &str,
    observed_at: OffsetDateTime,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO peer_endpoint_history (device_id, endpoint, observed_at)
           VALUES ($1, $2, $3)"#,
    )
    .bind(device_id)
    .bind(endpoint)
    .bind(observed_at)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, ToSchema)]
pub struct EndpointRow {
    pub id: i64,
    pub endpoint: String,
    #[serde(with = "time::serde::rfc3339")]
    pub observed_at: OffsetDateTime,
}

/// Most-recent endpoints for a device, newest first. Powers the admin
/// device-detail "connection history" tab.
pub async fn list_for_device(
    pool: &PgPool,
    device_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<EndpointRow>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, EndpointRow>(
        r#"SELECT id, endpoint, observed_at
             FROM peer_endpoint_history
            WHERE device_id = $1
            ORDER BY observed_at DESC, id DESC
            LIMIT $2"#,
    )
    .bind(device_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}
