use axum::{
    Json,
    extract::{Path, State},
    response::IntoResponse,
};
use garde::Validate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tracing::info;
use uuid::Uuid;
use zerovpn_db::repos::{api_tokens, audit};
use zerovpn_db::repos::api_tokens::ApiTokenScope;

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::CurrentUser,
    state::AppState,
};

const MAX_TOKENS_PER_USER: usize = 10;

#[derive(Debug, Deserialize, Validate)]
pub struct CreateBody {
    #[garde(length(min = 1, max = 64))]
    pub name: String,
    #[garde(skip)]
    pub scope: Option<ApiTokenScope>,
    #[garde(skip)]
    /// Optional: number of days until expiry. None = never.
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CreatedToken {
    pub id: Uuid,
    pub name: String,
    pub scope: ApiTokenScope,
    pub plaintext_token: String,
    pub created_at: OffsetDateTime,
    pub expires_at: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize)]
pub struct PublicToken {
    pub id: Uuid,
    pub name: String,
    pub scope: ApiTokenScope,
    pub last_used_at: Option<OffsetDateTime>,
    pub expires_at: Option<OffsetDateTime>,
    pub revoked_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    let rows = api_tokens::list_for_user(&state.pool, user.id).await?;
    let out: Vec<PublicToken> = rows
        .into_iter()
        .map(|t| PublicToken {
            id: t.id,
            name: t.name,
            scope: t.scope,
            last_used_at: t.last_used_at,
            expires_at: t.expires_at,
            revoked_at: t.revoked_at,
            created_at: t.created_at,
        })
        .collect();
    Ok(Json(out))
}

pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<CreateBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;
    // Cap per-user.
    let existing = api_tokens::list_for_user(&state.pool, user.id).await?;
    let active = existing.iter().filter(|t| t.revoked_at.is_none()).count();
    if active >= MAX_TOKENS_PER_USER {
        return Err(ApiError::Conflict(format!(
            "max {MAX_TOKENS_PER_USER} active tokens per user"
        )));
    }

    let scope = body.scope.unwrap_or(ApiTokenScope::Read);
    let expires_at = body
        .expires_in_days
        .map(|d| OffsetDateTime::now_utc() + time::Duration::days(d));

    let (plaintext, hash) = zerovpn_auth::api_token::generate();
    let id = api_tokens::create(&state.pool, user.id, &body.name, &hash, scope, expires_at)
        .await?;

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "user.api_token_created",
            target_type: Some("api_token"),
            target_id: Some(id),
            metadata: json!({ "name": body.name, "scope": scope }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(user_id = %user.id, token_id = %id, name = %body.name, "api token created");

    Ok((
        axum::http::StatusCode::CREATED,
        Json(CreatedToken {
            id,
            name: body.name,
            scope,
            plaintext_token: plaintext,
            created_at: OffsetDateTime::now_utc(),
            expires_at,
        }),
    ))
}

pub async fn revoke(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let n = api_tokens::revoke(&state.pool, user.id, id).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "user.api_token_revoked",
            target_type: Some("api_token"),
            target_id: Some(id),
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    info!(user_id = %user.id, token_id = %id, "api token revoked");
    Ok(Json(json!({ "status": "ok" })))
}
