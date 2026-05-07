use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::PgPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "webhook_event", rename_all = "snake_case")]
pub enum WebhookEventKind {
    PeerConnected,
    PeerDisconnected,
    DevicePaused,
    DeviceRevoked,
    BandwidthThreshold,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WebhookRow {
    pub id: Uuid,
    pub name: String,
    pub url: String,
    pub events: Vec<WebhookEventKind>,
    pub active: bool,
    pub last_delivery_at: Option<OffsetDateTime>,
    pub last_status: Option<i32>,
    pub failure_count: i32,
    pub created_at: OffsetDateTime,
}

pub async fn create(
    pool: &PgPool,
    name: &str,
    url: &str,
    secret_hashed: Option<&str>,
    events: &[WebhookEventKind],
) -> sqlx::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO webhooks (id, name, url, secret_hashed, events)
           VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(id)
    .bind(name)
    .bind(url)
    .bind(secret_hashed)
    .bind(events)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn list(pool: &PgPool) -> sqlx::Result<Vec<WebhookRow>> {
    sqlx::query_as::<_, WebhookRow>(
        r#"SELECT id, name, url, events, active, last_delivery_at, last_status,
                  failure_count, created_at
             FROM webhooks
            ORDER BY created_at DESC"#,
    )
    .fetch_all(pool)
    .await
}

pub async fn delete(pool: &PgPool, id: Uuid) -> sqlx::Result<u64> {
    let res = sqlx::query("DELETE FROM webhooks WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

/// Find webhooks subscribed to a given event kind, used by the dispatcher.
pub async fn for_event(
    pool: &PgPool,
    event: WebhookEventKind,
) -> sqlx::Result<Vec<WebhookRow>> {
    sqlx::query_as::<_, WebhookRow>(
        r#"SELECT id, name, url, events, active, last_delivery_at, last_status,
                  failure_count, created_at
             FROM webhooks
            WHERE active = TRUE AND $1 = ANY (events)"#,
    )
    .bind(event)
    .fetch_all(pool)
    .await
}

pub async fn record_delivery(
    pool: &PgPool,
    id: Uuid,
    status: i32,
    success: bool,
) -> sqlx::Result<()> {
    if success {
        sqlx::query(
            "UPDATE webhooks SET last_delivery_at = NOW(), last_status = $2, failure_count = 0
              WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "UPDATE webhooks SET last_delivery_at = NOW(), last_status = $2,
                                failure_count = failure_count + 1
              WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .execute(pool)
        .await?;
    }
    Ok(())
}
