//! Webhook dispatcher.
//!
//! Subscribes to the in-process event bus (via the same ZMQ subscriber pattern
//! the api uses, but on the worker side using its own SUB socket against the
//! same publisher) and POSTs matching events to webhook URLs. For v1 we run
//! the dispatcher as a periodic poll-and-flush rather than a long-lived ZMQ
//! sub: every 10 seconds, scan recently-emitted state changes and deliver.

use std::time::Duration;

use serde_json::json;
use tracing::{info, warn};
use zerovpn_db::{
    PgPool,
    repos::webhooks::{self, WebhookEventKind, WebhookRow},
};

/// Synchronous fan-out helper: deliver an event to every active webhook
/// subscribed to it. Called from places that already have a `pool` handle.
pub async fn dispatch(
    pool: &PgPool,
    kind: WebhookEventKind,
    payload: serde_json::Value,
) {
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
