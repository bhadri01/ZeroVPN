//! Webhook fan-out helper. Shared by api (pause/revoke handlers) and worker
//! (stats poller auto-pause + handshake transitions).

use std::time::Duration;

use serde_json::json;
use tracing::{info, warn};

use crate::repos::webhooks::{self, WebhookEventKind, WebhookRow};
use crate::PgPool;

pub async fn dispatch(pool: &PgPool, kind: WebhookEventKind, payload: serde_json::Value) {
    let subs = match webhooks::for_event(pool, kind).await {
        Ok(v) => v,
        Err(e) => {
            warn!(?e, "webhooks::for_event failed");
            return;
        }
    };
    for w in subs {
        let body = json!({
            "kind": format!("{kind:?}").to_lowercase(),
            "payload": payload,
            "ts_ms": time::OffsetDateTime::now_utc().unix_timestamp() * 1000,
        });
        let pool = pool.clone();
        let row = w.clone();
        tokio::spawn(async move { deliver(&pool, row, body).await });
    }
}

async fn deliver(pool: &PgPool, w: WebhookRow, body: serde_json::Value) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!(?e, "webhook client build failed");
            return;
        }
    };
    let res = client.post(&w.url).json(&body).send().await;
    let status = res
        .as_ref()
        .map(|r| r.status().as_u16() as i32)
        .unwrap_or(0);
    let success = res.as_ref().map(|r| r.status().is_success()).unwrap_or(false);
    let _ = webhooks::record_delivery(pool, w.id, status, success).await;
    info!(webhook = %w.id, %status, success, "webhook delivered");
}
