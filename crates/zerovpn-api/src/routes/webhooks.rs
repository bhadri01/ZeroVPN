use axum::{
    Json,
    extract::{Path, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tracing::info;
use uuid::Uuid;
use zerovpn_db::repos::{audit, webhooks};
use zerovpn_db::repos::webhooks::WebhookEventKind;

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::RequireAdmin,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct CreateBody {
    pub name: String,
    pub url: String,
    pub events: Vec<WebhookEventKind>,
    /// Optional shared secret. If set, deliveries include `X-ZeroVPN-Signature`.
    pub secret: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WebhookOut {
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

impl From<webhooks::WebhookRow> for WebhookOut {
    fn from(w: webhooks::WebhookRow) -> Self {
        Self {
            id: w.id,
            name: w.name,
            url: w.url,
            events: w.events,
            active: w.active,
            last_delivery_at: w.last_delivery_at,
            last_status: w.last_status,
            failure_count: w.failure_count,
            created_at: w.created_at,
        }
    }
}

pub async fn list(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
) -> ApiResult<impl IntoResponse> {
    let rows = webhooks::list(&state.pool).await?;
    let out: Vec<WebhookOut> = rows.into_iter().map(Into::into).collect();
    Ok(Json(out))
}

pub async fn create(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Json(body): Json<CreateBody>,
) -> ApiResult<impl IntoResponse> {
    if body.name.trim().is_empty() {
        return Err(ApiError::Validation("name is required".into()));
    }
    if !body.url.starts_with("http://") && !body.url.starts_with("https://") {
        return Err(ApiError::Validation("url must be http(s)://".into()));
    }
    let secret_hashed = body.secret.as_deref().map(zerovpn_auth::api_token::hash);
    let id = webhooks::create(
        &state.pool,
        body.name.trim(),
        body.url.trim(),
        secret_hashed.as_deref(),
        &body.events,
    )
    .await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.webhook_created",
            target_type: Some("webhook"),
            target_id: Some(id),
            metadata: json!({ "name": body.name, "url": body.url }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, webhook = %id, "webhook created");
    Ok((axum::http::StatusCode::CREATED, Json(json!({ "id": id }))))
}

pub async fn delete(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let n = webhooks::delete(&state.pool, id).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.webhook_deleted",
            target_type: Some("webhook"),
            target_id: Some(id),
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    Ok(Json(json!({ "status": "ok" })))
}
