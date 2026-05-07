use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tracing::info;
use uuid::Uuid;
use zerovpn_core::models::{UserRole, UserStatus};
use zerovpn_db::repos::{audit, users};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::RequireAdmin,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}
fn default_limit() -> i64 { 50 }

#[derive(Debug, Serialize)]
pub struct AdminUser {
    pub id: Uuid,
    pub email: String,
    pub role: UserRole,
    pub status: UserStatus,
    pub totp_enabled: bool,
    pub created_at: OffsetDateTime,
    pub last_login_at: Option<OffsetDateTime>,
    pub device_count: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminUserList {
    pub total: i64,
    pub items: Vec<AdminUser>,
}

pub async fn list_users(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Query(q): Query<ListQuery>,
) -> ApiResult<impl IntoResponse> {
    let limit = q.limit.clamp(1, 200);
    let offset = q.offset.max(0);
    let total = users::admin_count(&state.pool, q.q.as_deref()).await?;
    let rows = users::admin_list(&state.pool, limit, offset, q.q.as_deref()).await?;
    let items = rows
        .into_iter()
        .map(|u| AdminUser {
            id: u.id,
            email: u.email,
            role: u.role,
            status: u.status,
            totp_enabled: u.totp_enabled,
            created_at: u.created_at,
            last_login_at: u.last_login_at,
            device_count: u.device_count,
        })
        .collect();
    Ok(Json(AdminUserList { total, items }))
}

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: UserStatus,
}

pub async fn set_user_status(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(target_id): Path<Uuid>,
    Json(body): Json<StatusBody>,
) -> ApiResult<impl IntoResponse> {
    if target_id == actor.id {
        return Err(ApiError::Validation("cannot change your own status".into()));
    }
    let n = users::admin_set_status(&state.pool, target_id, body.status).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_status_changed",
            target_type: Some("user"),
            target_id: Some(target_id),
            metadata: json!({ "status": body.status }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target_id, status = ?body.status, "admin set user status");
    Ok(Json(json!({ "status": "ok" })))
}

// ---- Audit log ------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    /// Optional action filter, e.g. "device.created".
    #[serde(default)]
    pub action: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AuditRow {
    pub id: i64,
    pub actor_user_id: Option<Uuid>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub metadata: serde_json::Value,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct AuditList {
    pub items: Vec<AuditRow>,
}

pub async fn list_audit(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Query(q): Query<AuditQuery>,
) -> ApiResult<impl IntoResponse> {
    let limit = q.limit.clamp(1, 500);
    let offset = q.offset.max(0);
    let items: Vec<AuditRow> = sqlx::query_as(
        r#"SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at
             FROM audit_logs
            WHERE ($3::TEXT IS NULL OR action = $3)
            ORDER BY id DESC
            LIMIT $1 OFFSET $2"#,
    )
    .bind(limit)
    .bind(offset)
    .bind(q.action.as_deref())
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(AuditList { items }))
}

// ---- Failed logins --------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FailedLoginRow {
    pub id: i64,
    pub email_attempted: Option<String>,
    pub reason: zerovpn_db::repos::failed_logins::FailedLoginReason,
    pub attempted_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct FailedLoginList {
    pub items: Vec<FailedLoginRow>,
}

/// Audit log as CSV for download.
pub async fn list_audit_csv(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Query(q): Query<AuditQuery>,
) -> ApiResult<axum::response::Response> {
    let limit = q.limit.clamp(1, 5000);
    let items: Vec<AuditRow> = sqlx::query_as(
        r#"SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at
             FROM audit_logs
            WHERE ($2::TEXT IS NULL OR action = $2)
            ORDER BY id DESC
            LIMIT $1"#,
    )
    .bind(limit)
    .bind(q.action.as_deref())
    .fetch_all(&state.pool)
    .await?;

    let mut buf = Vec::with_capacity(64 * items.len());
    {
        let mut wtr = csv::Writer::from_writer(&mut buf);
        wtr.write_record(["id", "actor_user_id", "action", "target_type", "target_id", "metadata", "created_at"])
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        for r in items {
            wtr.write_record([
                r.id.to_string(),
                r.actor_user_id.map(|u| u.to_string()).unwrap_or_default(),
                r.action,
                r.target_type.unwrap_or_default(),
                r.target_id.map(|t| t.to_string()).unwrap_or_default(),
                r.metadata.to_string(),
                r.created_at.unix_timestamp().to_string(),
            ])
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        }
        wtr.flush().map_err(|e| ApiError::Internal(e.to_string()))?;
    }

    use axum::http::header;
    let resp = axum::response::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"audit.csv\"",
        )
        .body(axum::body::Body::from(buf))
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(resp)
}

#[derive(Debug, Deserialize)]
pub struct QuotaBody {
    /// Cap in bytes for the current month. Null/0 → unlimited.
    pub monthly_byte_cap: Option<i64>,
}

pub async fn set_user_quota(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(target_id): Path<Uuid>,
    Json(body): Json<QuotaBody>,
) -> ApiResult<impl IntoResponse> {
    let cap = body
        .monthly_byte_cap
        .filter(|c| *c > 0);
    sqlx::query(
        "UPDATE users SET monthly_byte_cap = $2 WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(target_id)
    .bind(cap)
    .execute(&state.pool)
    .await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_quota_set",
            target_type: Some("user"),
            target_id: Some(target_id),
            metadata: json!({ "monthly_byte_cap": cap }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target_id, ?cap, "admin set user quota");
    Ok(Json(json!({ "status": "ok" })))
}

pub async fn list_failed_logins(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Query(q): Query<AuditQuery>,
) -> ApiResult<impl IntoResponse> {
    let limit = q.limit.clamp(1, 500);
    let offset = q.offset.max(0);
    let items: Vec<FailedLoginRow> = sqlx::query_as(
        r#"SELECT id, email_attempted::TEXT AS email_attempted, reason, attempted_at
             FROM failed_logins
            ORDER BY id DESC
            LIMIT $1 OFFSET $2"#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(FailedLoginList { items }))
}

// ---- Maintenance mode -----------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MaintenanceState {
    pub maintenance_mode: bool,
    pub maintenance_message: Option<String>,
    pub updated_at: OffsetDateTime,
}

pub async fn get_maintenance(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
) -> ApiResult<impl IntoResponse> {
    let row: MaintenanceState = sqlx::query_as(
        "SELECT maintenance_mode, maintenance_message, updated_at FROM app_settings WHERE id = 1",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct MaintenanceBody {
    pub maintenance_mode: bool,
    pub maintenance_message: Option<String>,
}

pub async fn set_maintenance(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Json(body): Json<MaintenanceBody>,
) -> ApiResult<impl IntoResponse> {
    sqlx::query(
        "UPDATE app_settings SET maintenance_mode = $1, maintenance_message = $2 WHERE id = 1",
    )
    .bind(body.maintenance_mode)
    .bind(&body.maintenance_message)
    .execute(&state.pool)
    .await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.maintenance_mode",
            target_type: None,
            target_id: None,
            metadata: json!({ "on": body.maintenance_mode }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(on = body.maintenance_mode, "maintenance mode toggled");
    Ok(Json(json!({ "status": "ok" })))
}
