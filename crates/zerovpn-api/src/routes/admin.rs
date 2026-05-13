use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tower_sessions::Session;
use tracing::{info, warn};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use zerovpn_core::models::{Server, UserRole, UserStatus};
use zerovpn_db::repos::{
    audit, bandwidth, devices, servers,
    users::{self, AdminUserFilters},
};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::{
        RequireAdmin, SESSION_KEY_PW_CHANGED_AT, SESSION_KEY_REAL_PW_CHANGED_AT,
        SESSION_KEY_REAL_USER_ID, SESSION_KEY_USER_ID,
    },
    routes::{
        devices::{PERSISTENT_KEEPALIVE, PublicDevice},
        dto::StatusAck,
        email_auth,
    },
    state::AppState,
};

// ── WireGuard sync helpers ──────────────────────────────────────────────
// Used whenever an account-level lifecycle change should ripple out to
// the live WG interface — suspend/unsuspend/delete on a user. Each
// helper is best-effort: we log peer-level failures but never abort the
// account-level operation, so the DB always converges even if WG is
// temporarily unreachable. The reconciler picks up any drift later.

/// Drop every active peer that belongs to this user from the live WG
/// interface. Use on suspend / delete to actually disconnect the user
/// instead of just blocking their dashboard access.
async fn remove_user_peers(state: &AppState, user_id: Uuid) {
    let user_devices = match devices::list_for_user(&state.pool, user_id).await {
        Ok(rows) => rows,
        Err(e) => {
            warn!(?e, %user_id, "remove_user_peers: list_for_user failed");
            return;
        }
    };
    for d in user_devices {
        // Only `Active` devices have a peer registered on the WG box —
        // `Paused` devices were already torn down at pause time.
        if d.status != zerovpn_core::models::DeviceStatus::Active {
            continue;
        }
        if let Err(e) = state.wg.remove_peer(&d.public_key).await {
            warn!(?e, device_id = %d.id, "remove_user_peers: wg remove_peer failed");
        }
    }
}

/// Re-add every active peer that belongs to this user to the live WG
/// interface. Use on unsuspend so previously-suspended users can
/// reconnect immediately without rotating keys or re-downloading the
/// .conf. Paused devices stay paused.
async fn restore_user_peers(state: &AppState, user_id: Uuid) {
    let user_devices = match devices::list_for_user(&state.pool, user_id).await {
        Ok(rows) => rows,
        Err(e) => {
            warn!(?e, %user_id, "restore_user_peers: list_for_user failed");
            return;
        }
    };
    for d in user_devices {
        if d.status != zerovpn_core::models::DeviceStatus::Active {
            continue;
        }
        if let Err(e) = state
            .wg
            .add_peer(&d.public_key, d.allocated_ip.ip(), None, PERSISTENT_KEEPALIVE)
            .await
        {
            warn!(?e, device_id = %d.id, "restore_user_peers: wg add_peer failed");
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ListQuery {
    /// Free-text email search (substring, case-insensitive).
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    /// Filter by account status. Omit to include every status.
    #[serde(default)]
    pub status: Option<UserStatus>,
    /// Filter by role. Omit to include every role.
    #[serde(default)]
    pub role: Option<UserRole>,
    /// Filter by 2FA enrollment. Omit to ignore.
    #[serde(default)]
    pub totp_enabled: Option<bool>,
}
fn default_limit() -> i64 { 50 }

impl ListQuery {
    fn filters(&self) -> AdminUserFilters<'_> {
        AdminUserFilters {
            search: self.q.as_deref(),
            status: self.status,
            role: self.role,
            totp_enabled: self.totp_enabled,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUser {
    pub id: Uuid,
    pub email: String,
    pub role: UserRole,
    pub status: UserStatus,
    pub totp_enabled: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_login_at: Option<OffsetDateTime>,
    pub device_count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUserList {
    pub total: i64,
    pub items: Vec<AdminUser>,
}

#[utoipa::path(
    get,
    path = "/admin/users",
    tag = "Admin",
    params(ListQuery),
    responses(
        (status = 200, description = "Paginated user list", body = AdminUserList),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn list_users(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Query(q): Query<ListQuery>,
) -> ApiResult<impl IntoResponse> {
    let limit = q.limit.clamp(1, 200);
    let offset = q.offset.max(0);
    let f = q.filters();
    let total = users::admin_count(&state.pool, f).await?;
    let rows = users::admin_list(&state.pool, limit, offset, f).await?;
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

/// CSV export of the filtered user list. Same filters as `list_users`,
/// but returns the full result (capped at 10000 rows) so an admin can
/// hand the file off for spreadsheet review.
#[utoipa::path(
    get,
    path = "/admin/users.csv",
    tag = "Admin",
    params(ListQuery),
    responses(
        (status = 200, description = "CSV download", content_type = "text/csv"),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn list_users_csv(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Query(q): Query<ListQuery>,
) -> ApiResult<axum::response::Response> {
    let f = q.filters();
    let rows = users::admin_list(&state.pool, 10_000, 0, f).await?;

    let mut buf = Vec::with_capacity(80 * rows.len());
    {
        let mut wtr = csv::Writer::from_writer(&mut buf);
        wtr.write_record([
            "id",
            "email",
            "role",
            "status",
            "totp_enabled",
            "created_at",
            "last_login_at",
            "device_count",
        ])
        .map_err(|e| ApiError::Internal(e.to_string()))?;
        for u in rows {
            // Enum serde already lowercases ("admin"/"user", "active"/...);
            // unwrap to the inner string to avoid the Debug-format trick.
            let role_s = serde_json::to_value(&u.role)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            let status_s = serde_json::to_value(&u.status)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            wtr.write_record([
                u.id.to_string(),
                u.email,
                role_s,
                status_s,
                u.totp_enabled.to_string(),
                u.created_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                u.last_login_at
                    .and_then(|t| t.format(&time::format_description::well_known::Rfc3339).ok())
                    .unwrap_or_default(),
                u.device_count.to_string(),
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
            "attachment; filename=\"users.csv\"",
        )
        .body(axum::body::Body::from(buf))
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(resp)
}

// ---- User detail --------------------------------------------------------

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUserDetail {
    pub id: Uuid,
    pub email: String,
    pub role: UserRole,
    pub status: UserStatus,
    pub totp_enabled: bool,
    pub must_change_password: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_login_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub email_verified_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub password_changed_at: OffsetDateTime,
    pub current_month_bytes: i64,
    pub monthly_byte_cap: Option<i64>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub quota_resets_at: Option<OffsetDateTime>,
    pub device_count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUserDevice {
    pub id: Uuid,
    pub name: String,
    pub os: zerovpn_core::models::DeviceOs,
    pub status: zerovpn_core::models::DeviceStatus,
    pub allocated_ip: String,
    pub dns_names: Vec<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_handshake_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUserActivity {
    pub id: i64,
    pub action: String,
    pub metadata: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUserDetailResponse {
    pub user: AdminUserDetail,
    pub devices: Vec<AdminUserDevice>,
    /// Recent audit entries where this user is the *target* (admin
    /// actions taken on them). Newest first, hard-capped at 50.
    pub activity: Vec<AdminUserActivity>,
}

#[utoipa::path(
    get,
    path = "/admin/users/{id}",
    tag = "Admin",
    params(
        ("id" = Uuid, Path, description = "Target user UUID"),
    ),
    responses(
        (status = 200, description = "Bundled user detail (core + quota + devices + recent activity)", body = AdminUserDetailResponse),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "User not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn user_detail(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Path(target_id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let row = users::admin_user_detail(&state.pool, target_id)
        .await?
        .ok_or(ApiError::NotFound)?;

    let device_rows = devices::list_for_user(&state.pool, target_id).await?;
    let devices = device_rows
        .into_iter()
        .map(|d| AdminUserDevice {
            id: d.id,
            name: d.name,
            os: d.os,
            status: d.status,
            allocated_ip: d.allocated_ip.ip().to_string(),
            dns_names: d.dns_names,
            last_handshake_at: d.last_handshake_at,
            created_at: d.created_at,
        })
        .collect();

    let activity_rows = audit::list_for_target(&state.pool, "user", target_id, 50).await?;
    let activity = activity_rows
        .into_iter()
        .map(|a| AdminUserActivity {
            id: a.id,
            action: a.action,
            metadata: a.metadata,
            created_at: a.created_at,
        })
        .collect();

    Ok(Json(AdminUserDetailResponse {
        user: AdminUserDetail {
            id: row.id,
            email: row.email,
            role: row.role,
            status: row.status,
            totp_enabled: row.totp_enabled,
            must_change_password: row.must_change_password,
            created_at: row.created_at,
            last_login_at: row.last_login_at,
            email_verified_at: row.email_verified_at,
            password_changed_at: row.password_changed_at,
            current_month_bytes: row.current_month_bytes,
            monthly_byte_cap: row.monthly_byte_cap,
            quota_resets_at: row.quota_resets_at,
            device_count: row.device_count,
        },
        devices,
        activity,
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct StatusBody {
    pub status: UserStatus,
}

#[utoipa::path(
    put,
    path = "/admin/users/{id}/status",
    tag = "Admin",
    params(
        ("id" = Uuid, Path, description = "Target user UUID"),
    ),
    request_body = StatusBody,
    responses(
        (status = 200, description = "Status updated", body = StatusAck),
        (status = 400, description = "Cannot change your own status"),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "User not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn set_user_status(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(target_id): Path<Uuid>,
    Json(body): Json<StatusBody>,
) -> ApiResult<impl IntoResponse> {
    if target_id == actor.id {
        return Err(ApiError::Validation("cannot change your own status".into()));
    }
    // Snapshot the prior status so we know which side of the transition
    // we're on — needed to decide whether to tear down or restore peers.
    let prior = users::find_by_id(&state.pool, target_id)
        .await?
        .ok_or(ApiError::NotFound)?
        .status;
    let n = users::admin_set_status(&state.pool, target_id, body.status).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }

    // Sync the live WG interface to the new status. Suspending a user
    // only mattered to the dashboard before this — the tunnel itself
    // stayed up because peers were never removed. These two helpers
    // close that gap.
    if body.status == UserStatus::Suspended && prior != UserStatus::Suspended {
        remove_user_peers(&state, target_id).await;
        // Flush any open dashboard sessions: the auth extractor's
        // status check already returns 403 on the next request, but
        // bumping the pw watermark also kills the cookie's pw snapshot
        // so it can't ride a stale-but-valid session through anywhere
        // we *don't* gate on status (eg. prior to maintenance gating).
        let _ = users::kill_all_sessions(&state.pool, target_id).await;
    } else if body.status == UserStatus::Active && prior == UserStatus::Suspended {
        restore_user_peers(&state, target_id).await;
    }

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_status_changed",
            target_type: Some("user"),
            target_id: Some(target_id),
            metadata: json!({ "status": body.status, "prior": prior }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target_id, status = ?body.status, "admin set user status");
    Ok(Json(json!({ "status": "ok" })))
}

// ---- Role change ----------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct RoleBody {
    pub role: UserRole,
}

#[utoipa::path(
    put,
    path = "/admin/users/{id}/role",
    tag = "Admin",
    params(("id" = Uuid, Path, description = "Target user UUID")),
    request_body = RoleBody,
    responses(
        (status = 200, description = "Role updated", body = StatusAck),
        (status = 400, description = "Cannot demote yourself / cannot demote the last admin"),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "User not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn set_user_role(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(target_id): Path<Uuid>,
    Json(body): Json<RoleBody>,
) -> ApiResult<impl IntoResponse> {
    if target_id == actor.id {
        return Err(ApiError::Validation("cannot change your own role".into()));
    }
    // Don't strand the deployment without an admin: the last active admin
    // can't be demoted. Bootstrap can always re-promote via direct DB
    // access if everyone leaves.
    if body.role == UserRole::User {
        let target = users::find_by_id(&state.pool, target_id)
            .await?
            .ok_or(ApiError::NotFound)?;
        if target.role == UserRole::Admin {
            let admins = users::count_active_admins(&state.pool).await?;
            if admins <= 1 {
                return Err(ApiError::Validation(
                    "cannot demote the last remaining admin".into(),
                ));
            }
        }
    }
    let n = users::admin_set_role(&state.pool, target_id, body.role).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_role_changed",
            target_type: Some("user"),
            target_id: Some(target_id),
            metadata: json!({ "role": body.role }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target_id, role = ?body.role, "admin set user role");
    Ok(Json(json!({ "status": "ok" })))
}

// ---- Trigger password reset ----------------------------------------------

#[utoipa::path(
    post,
    path = "/admin/users/{id}/reset-password",
    tag = "Admin",
    params(("id" = Uuid, Path, description = "Target user UUID")),
    responses(
        (status = 200, description = "Reset link emailed (or logged in dev)", body = StatusAck),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "User not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn admin_send_reset(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(target_id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let target = users::find_by_id(&state.pool, target_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if target.status == UserStatus::Deleted {
        return Err(ApiError::Validation("user is deleted".into()));
    }
    email_auth::issue_password_reset(&state, target.id, &target.email).await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_password_reset_sent",
            target_type: Some("user"),
            target_id: Some(target.id),
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target.id, "admin issued password-reset link");
    Ok(Json(json!({ "status": "ok" })))
}

// ---- Disable 2FA ----------------------------------------------------------

#[utoipa::path(
    post,
    path = "/admin/users/{id}/disable-2fa",
    tag = "Admin",
    params(("id" = Uuid, Path, description = "Target user UUID")),
    responses(
        (status = 200, description = "TOTP cleared and recovery codes wiped", body = StatusAck),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "User not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn admin_disable_2fa(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(target_id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let target = users::find_by_id(&state.pool, target_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    users::disable_totp(&state.pool, target.id).await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_2fa_disabled",
            target_type: Some("user"),
            target_id: Some(target.id),
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target.id, "admin cleared TOTP");
    Ok(Json(json!({ "status": "ok" })))
}

// ---- Force-logout (revoke all sessions) ----------------------------------

#[utoipa::path(
    post,
    path = "/admin/users/{id}/sessions/revoke-all",
    tag = "Admin",
    params(("id" = Uuid, Path, description = "Target user UUID")),
    responses(
        (status = 200, description = "All open sessions for this user invalidated", body = StatusAck),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "User not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn admin_revoke_sessions(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(target_id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let target = users::find_by_id(&state.pool, target_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let n = users::kill_all_sessions(&state.pool, target.id).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_sessions_revoked",
            target_type: Some("user"),
            target_id: Some(target.id),
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target.id, "admin revoked all sessions");
    Ok(Json(json!({ "status": "ok" })))
}

// ---- Edit email ----------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct EmailBody {
    pub email: String,
}

#[utoipa::path(
    put,
    path = "/admin/users/{id}/email",
    tag = "Admin",
    params(("id" = Uuid, Path, description = "Target user UUID")),
    request_body = EmailBody,
    responses(
        (status = 200, description = "Email updated", body = StatusAck),
        (status = 400, description = "Validation failed (bad shape, taken, deleted user)"),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "User not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn admin_set_email_route(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(target_id): Path<Uuid>,
    Json(body): Json<EmailBody>,
) -> ApiResult<impl IntoResponse> {
    let new_email = body.email.trim().to_lowercase();
    if !new_email.contains('@') || new_email.len() < 3 {
        return Err(ApiError::Validation("invalid email shape".into()));
    }
    let target = users::find_by_id(&state.pool, target_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if target.status == UserStatus::Deleted {
        return Err(ApiError::Validation("user is deleted".into()));
    }
    if target.email.to_lowercase() == new_email {
        // No-op: same email after normalisation. Don't write or audit.
        return Ok(Json(json!({ "status": "ok" })));
    }
    if let Some(other) = users::find_by_email(&state.pool, &new_email).await? {
        if other.id != target_id {
            return Err(ApiError::Validation("email already in use".into()));
        }
    }
    let n = users::admin_set_email(&state.pool, target.id, &new_email).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_email_changed",
            target_type: Some("user"),
            target_id: Some(target.id),
            metadata: json!({ "from": target.email, "to": new_email }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target.id, "admin changed email");
    Ok(Json(json!({ "status": "ok" })))
}

// ---- Delete user ----------------------------------------------------------

#[utoipa::path(
    delete,
    path = "/admin/users/{id}",
    tag = "Admin",
    params(("id" = Uuid, Path, description = "Target user UUID")),
    responses(
        (status = 200, description = "User soft-deleted: PII nulled, devices revoked, sessions killed", body = StatusAck),
        (status = 400, description = "Cannot delete yourself / last admin"),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "User not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn delete_user(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(target_id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    if target_id == actor.id {
        return Err(ApiError::Validation("cannot delete yourself".into()));
    }
    let target = users::find_by_id(&state.pool, target_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if target.role == UserRole::Admin {
        let admins = users::count_active_admins(&state.pool).await?;
        if admins <= 1 {
            return Err(ApiError::Validation(
                "cannot delete the last remaining admin".into(),
            ));
        }
    }
    // Tear down the live WG peers AND release IPs BEFORE soft-deleting.
    // After soft_delete every device row is marked revoked, so iterating
    // afterwards would find nothing to remove. Best-effort — failures
    // log but don't block the deletion.
    if let Ok(user_devices) = devices::list_for_user(&state.pool, target.id).await {
        for d in user_devices {
            if d.status == zerovpn_core::models::DeviceStatus::Active {
                if let Err(e) = state.wg.remove_peer(&d.public_key).await {
                    warn!(?e, device_id = %d.id, "delete_user: wg remove_peer failed");
                }
            }
            if let Some(alloc) = state.allocators.get(d.server_id) {
                let _ = alloc.release(d.allocated_ip.ip());
            }
        }
    }
    // Kill any open dashboard sessions so a deleted user's cookie
    // fails the watermark check on the very next API request.
    let _ = users::kill_all_sessions(&state.pool, target.id).await;
    users::soft_delete(&state.pool, target.id).await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_deleted",
            target_type: Some("user"),
            target_id: Some(target.id),
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target.id, "admin deleted user");
    Ok(Json(json!({ "status": "ok" })))
}

// ---- Create / invite user ------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateUserBody {
    pub email: String,
    /// Optional initial password. When omitted, a random 24-char password
    /// is generated server-side and the response carries it back exactly
    /// once so the admin can deliver it out-of-band; the user is then
    /// flagged `must_change_password` so they're forced to rotate on
    /// first sign-in.
    #[serde(default)]
    pub password: Option<String>,
    /// Default `user`. Set to `admin` to create another administrator.
    #[serde(default = "default_role")]
    pub role: UserRole,
    /// When true, skip the email-verification gate so the user can sign
    /// in immediately. Defaults to false (we mint a verify-email link).
    #[serde(default)]
    pub skip_verification: bool,
    /// When true (default), email a password-reset link instead of
    /// returning the generated password. Ignored when `password` is set.
    #[serde(default = "default_true")]
    pub email_setup_link: bool,
}

fn default_role() -> UserRole {
    UserRole::User
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreatedUserResponse {
    pub id: Uuid,
    pub email: String,
    pub role: UserRole,
    pub status: UserStatus,
    /// Plaintext password — only present when the admin asked us to
    /// generate one AND chose not to email a setup link. Never logged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_password: Option<String>,
}

#[utoipa::path(
    post,
    path = "/admin/users",
    tag = "Admin",
    request_body = CreateUserBody,
    responses(
        (status = 200, description = "User created", body = CreatedUserResponse),
        (status = 400, description = "Validation error / email already taken"),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn create_user(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Json(body): Json<CreateUserBody>,
) -> ApiResult<impl IntoResponse> {
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(ApiError::Validation("email is required and must contain @".into()));
    }
    if let Some(p) = body.password.as_deref() {
        if p.len() < 12 {
            return Err(ApiError::Validation(
                "password must be at least 12 characters".into(),
            ));
        }
    }
    if users::find_by_email(&state.pool, &email).await?.is_some() {
        return Err(ApiError::Validation("email already in use".into()));
    }

    let (password_plain, generated) = match body.password.as_deref() {
        Some(p) => (p.to_string(), false),
        None => (generate_random_password(24), true),
    };
    let password_hash = zerovpn_auth::password::hash(&password_plain)?;

    let initial_status = if body.skip_verification {
        UserStatus::Active
    } else {
        UserStatus::PendingVerification
    };
    let id = users::create(
        &state.pool,
        &email,
        &password_hash,
        body.role,
        initial_status,
    )
    .await?;

    // Force a rotation on first login when we generated the password.
    if generated {
        sqlx::query(
            "UPDATE users SET must_change_password = TRUE WHERE id = $1",
        )
        .bind(id)
        .execute(&state.pool)
        .await?;
    }

    // Mark email as verified up-front when the admin chose to skip the
    // verify gate — otherwise the dashboard's gating still trips.
    if body.skip_verification {
        sqlx::query(
            "UPDATE users SET email_verified_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .execute(&state.pool)
        .await?;
    } else if let Err(e) = email_auth::issue_verify_email(&state, id, &email).await {
        warn!(?e, %id, "create_user: verify-email send failed");
    }

    // If the admin generated a password and asked us to email a setup
    // link, ship a password-reset email and don't return the plaintext.
    let return_password = if generated && body.email_setup_link {
        if let Err(e) = email_auth::issue_password_reset(&state, id, &email).await {
            warn!(?e, %id, "create_user: setup-link send failed");
        }
        None
    } else if generated {
        Some(password_plain)
    } else {
        None
    };

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.user_created",
            target_type: Some("user"),
            target_id: Some(id),
            metadata: json!({
                "role": body.role,
                "skip_verification": body.skip_verification,
                "generated_password": generated,
            }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %id, role = ?body.role, "admin created user");

    Ok(Json(CreatedUserResponse {
        id,
        email,
        role: body.role,
        status: initial_status,
        generated_password: return_password,
    }))
}

/// Cryptographically random alphanumeric password. Uses the OS RNG via
/// rand::thread_rng so each invocation produces independent bytes.
fn generate_random_password(len: usize) -> String {
    use rand::Rng;
    const CHARSET: &[u8] =
        b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

// ---- User bandwidth history ----------------------------------------------

#[derive(Debug, Deserialize, IntoParams)]
pub struct BandwidthRangeQuery {
    /// "24h" | "7d" | "30d". Defaults to "24h".
    #[serde(default)]
    pub range: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUserBandwidthBucket {
    #[serde(with = "time::serde::rfc3339")]
    pub bucket_start: OffsetDateTime,
    pub rx_bytes: i64,
    pub tx_bytes: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUserBandwidthResponse {
    pub bucket: &'static str,
    pub range: String,
    pub buckets: Vec<AdminUserBandwidthBucket>,
}

#[utoipa::path(
    get,
    path = "/admin/users/{id}/bandwidth",
    tag = "Admin",
    params(("id" = Uuid, Path, description = "Target user UUID"), BandwidthRangeQuery),
    responses(
        (status = 200, description = "Bucketed RX/TX history aggregated across the user's devices", body = AdminUserBandwidthResponse),
        (status = 400, description = "Invalid range"),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn user_bandwidth(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Path(target_id): Path<Uuid>,
    Query(q): Query<BandwidthRangeQuery>,
) -> ApiResult<impl IntoResponse> {
    let range = q.range.unwrap_or_else(|| "24h".into());
    let (since, bucket) = match range.as_str() {
        "24h" => (OffsetDateTime::now_utc() - time::Duration::hours(24), "hour"),
        "7d" => (OffsetDateTime::now_utc() - time::Duration::days(7), "hour"),
        "30d" => (OffsetDateTime::now_utc() - time::Duration::days(30), "day"),
        other => {
            return Err(ApiError::Validation(format!(
                "range must be 24h | 7d | 30d (got {other})"
            )));
        }
    };
    let rows = bandwidth::user_totals(&state.pool, target_id, since, bucket).await?;
    Ok(Json(AdminUserBandwidthResponse {
        bucket: if bucket == "hour" { "hour" } else { "day" },
        range,
        buckets: rows
            .into_iter()
            .map(|b| AdminUserBandwidthBucket {
                bucket_start: b.bucket_start,
                rx_bytes: b.rx_bytes,
                tx_bytes: b.tx_bytes,
            })
            .collect(),
    }))
}

// ---- Audit log ------------------------------------------------------------

#[derive(Debug, Deserialize, IntoParams)]
pub struct AuditQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    /// Optional action filter, e.g. "device.created".
    #[serde(default)]
    pub action: Option<String>,
    /// Restrict to entries authored by this user.
    #[serde(default)]
    pub actor_user_id: Option<Uuid>,
    /// Restrict to entries about this target (any target_type).
    #[serde(default)]
    pub target_id: Option<Uuid>,
    /// Restrict to entries with this target_type ("user", "device", "server", …).
    #[serde(default)]
    pub target_type: Option<String>,
    /// RFC3339 lower bound (inclusive). Restricts to created_at ≥ since.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub since: Option<OffsetDateTime>,
    /// RFC3339 upper bound (exclusive). Restricts to created_at < until.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub until: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct AuditRow {
    pub id: i64,
    pub actor_user_id: Option<Uuid>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub metadata: serde_json::Value,
    /// Full client IP serialised as `IpNetwork` ("203.0.113.42/32").
    /// Stage A — full address, no longer /24-truncated. Column name
    /// is still `ip_prefix` for back-compat; rename queued for Stage B.
    #[schema(value_type = Option<String>, example = "203.0.113.42/32")]
    pub ip_prefix: Option<IpNetwork>,
    /// Raw `User-Agent` header captured when the audit row was written.
    /// `NULL` for audit rows recorded outside of a route handler
    /// (worker tasks, CLI actions, internal state transitions).
    pub user_agent: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AuditList {
    /// Filtered total — count for the active `action` filter, ignoring
    /// `limit` / `offset`. Powers pagination controls on the admin page.
    pub total: i64,
    pub items: Vec<AuditRow>,
}

#[utoipa::path(
    get,
    path = "/admin/audit",
    tag = "Admin",
    params(AuditQuery),
    responses(
        (status = 200, description = "Audit log entries, newest first", body = AuditList),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn list_audit(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Query(q): Query<AuditQuery>,
) -> ApiResult<impl IntoResponse> {
    let limit = q.limit.clamp(1, 500);
    let offset = q.offset.max(0);
    // Single param-list shared between count + fetch so the WHERE
    // clauses stay in sync. NULL on a filter param disables it.
    let (total,): (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*)::BIGINT FROM audit_logs
            WHERE ($1::TEXT IS NULL OR action        = $1)
              AND ($2::UUID IS NULL OR actor_user_id = $2)
              AND ($3::UUID IS NULL OR target_id     = $3)
              AND ($4::TEXT IS NULL OR target_type   = $4)
              AND ($5::TIMESTAMPTZ IS NULL OR created_at >= $5)
              AND ($6::TIMESTAMPTZ IS NULL OR created_at <  $6)"#,
    )
    .bind(q.action.as_deref())
    .bind(q.actor_user_id)
    .bind(q.target_id)
    .bind(q.target_type.as_deref())
    .bind(q.since)
    .bind(q.until)
    .fetch_one(&state.pool)
    .await?;
    let items: Vec<AuditRow> = sqlx::query_as(
        r#"SELECT id, actor_user_id, action, target_type, target_id, metadata,
                  ip_prefix, user_agent, created_at
             FROM audit_logs
            WHERE ($3::TEXT IS NULL OR action        = $3)
              AND ($4::UUID IS NULL OR actor_user_id = $4)
              AND ($5::UUID IS NULL OR target_id     = $5)
              AND ($6::TEXT IS NULL OR target_type   = $6)
              AND ($7::TIMESTAMPTZ IS NULL OR created_at >= $7)
              AND ($8::TIMESTAMPTZ IS NULL OR created_at <  $8)
            ORDER BY id DESC
            LIMIT $1 OFFSET $2"#,
    )
    .bind(limit)
    .bind(offset)
    .bind(q.action.as_deref())
    .bind(q.actor_user_id)
    .bind(q.target_id)
    .bind(q.target_type.as_deref())
    .bind(q.since)
    .bind(q.until)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(AuditList { total, items }))
}

// ---- Failed logins --------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct FailedLoginRow {
    pub id: i64,
    pub email_attempted: Option<String>,
    pub reason: zerovpn_db::repos::failed_logins::FailedLoginReason,
    /// Full client IP (Phase 2 / Stage A) — column is still named
    /// `ip_prefix` for back-compat; semantically a `/32` or `/128` host
    /// network now. Surfaced as a string so the OpenAPI consumer doesn't
    /// have to know IpNetwork's serde form.
    #[schema(value_type = Option<String>, example = "203.0.113.42/32")]
    pub ip_prefix: Option<IpNetwork>,
    /// Raw `User-Agent` header from the failing request. Plaintext.
    pub user_agent: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub attempted_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FailedLoginList {
    /// Total failed-login rows in the DB (ignoring `limit` / `offset`).
    /// Drives pagination controls on the admin page.
    pub total: i64,
    pub items: Vec<FailedLoginRow>,
}

/// Audit log as CSV for download.
#[utoipa::path(
    get,
    path = "/admin/audit.csv",
    tag = "Admin",
    params(AuditQuery),
    responses(
        (status = 200, description = "CSV download", content_type = "text/csv"),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn list_audit_csv(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Query(q): Query<AuditQuery>,
) -> ApiResult<axum::response::Response> {
    let limit = q.limit.clamp(1, 5000);
    let items: Vec<AuditRow> = sqlx::query_as(
        r#"SELECT id, actor_user_id, action, target_type, target_id, metadata,
                  ip_prefix, user_agent, created_at
             FROM audit_logs
            WHERE ($2::TEXT IS NULL OR action        = $2)
              AND ($3::UUID IS NULL OR actor_user_id = $3)
              AND ($4::UUID IS NULL OR target_id     = $4)
              AND ($5::TEXT IS NULL OR target_type   = $5)
              AND ($6::TIMESTAMPTZ IS NULL OR created_at >= $6)
              AND ($7::TIMESTAMPTZ IS NULL OR created_at <  $7)
            ORDER BY id DESC
            LIMIT $1"#,
    )
    .bind(limit)
    .bind(q.action.as_deref())
    .bind(q.actor_user_id)
    .bind(q.target_id)
    .bind(q.target_type.as_deref())
    .bind(q.since)
    .bind(q.until)
    .fetch_all(&state.pool)
    .await?;

    let mut buf = Vec::with_capacity(64 * items.len());
    {
        let mut wtr = csv::Writer::from_writer(&mut buf);
        wtr.write_record([
            "id",
            "actor_user_id",
            "action",
            "target_type",
            "target_id",
            "metadata",
            "ip",
            "user_agent",
            "created_at",
        ])
        .map_err(|e| ApiError::Internal(e.to_string()))?;
        for r in items {
            wtr.write_record([
                r.id.to_string(),
                r.actor_user_id.map(|u| u.to_string()).unwrap_or_default(),
                r.action,
                r.target_type.unwrap_or_default(),
                r.target_id.map(|t| t.to_string()).unwrap_or_default(),
                r.metadata.to_string(),
                r.ip_prefix.map(|i| i.to_string()).unwrap_or_default(),
                r.user_agent.unwrap_or_default(),
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

#[derive(Debug, Deserialize, ToSchema)]
pub struct QuotaBody {
    /// Cap in bytes for the current month. Null/0 → unlimited.
    pub monthly_byte_cap: Option<i64>,
}

#[utoipa::path(
    put,
    path = "/admin/users/{id}/quota",
    tag = "Admin",
    params(
        ("id" = Uuid, Path, description = "Target user UUID"),
    ),
    request_body = QuotaBody,
    responses(
        (status = 200, description = "Quota updated (null/0 = unlimited)", body = StatusAck),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
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

#[utoipa::path(
    get,
    path = "/admin/failed-logins",
    tag = "Admin",
    params(AuditQuery),
    responses(
        (status = 200, description = "Recent failed login attempts", body = FailedLoginList),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn list_failed_logins(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Query(q): Query<AuditQuery>,
) -> ApiResult<impl IntoResponse> {
    let limit = q.limit.clamp(1, 500);
    let offset = q.offset.max(0);
    let (total,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::BIGINT FROM failed_logins")
            .fetch_one(&state.pool)
            .await?;
    let items: Vec<FailedLoginRow> = sqlx::query_as(
        r#"SELECT id,
                  email_attempted::TEXT AS email_attempted,
                  reason,
                  ip_prefix,
                  user_agent,
                  attempted_at
             FROM failed_logins
            ORDER BY id DESC
            LIMIT $1 OFFSET $2"#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(FailedLoginList { total, items }))
}

// ---- Maintenance mode -----------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct MaintenanceState {
    pub maintenance_mode: bool,
    pub maintenance_message: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[utoipa::path(
    get,
    path = "/admin/maintenance",
    tag = "Admin",
    responses(
        (status = 200, description = "Current maintenance state", body = MaintenanceState),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn get_maintenance(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
) -> ApiResult<impl IntoResponse> {
    let row: MaintenanceState = sqlx::query_as(
        "SELECT maintenance_mode, maintenance_message, updated_at FROM app_settings WHERE id = 1",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MaintenanceBody {
    pub maintenance_mode: bool,
    pub maintenance_message: Option<String>,
}

#[utoipa::path(
    put,
    path = "/admin/maintenance",
    tag = "Admin",
    request_body = MaintenanceBody,
    responses(
        (status = 200, description = "Maintenance toggled (writes blocked for non-admins while ON)", body = StatusAck),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
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

// --- Server admin -----------------------------------------------------------

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminServer {
    pub id: Uuid,
    pub name: String,
    pub region: String,
    pub endpoint_host: String,
    pub endpoint_port: i32,
    pub public_key: String,
    /// CIDR rendered as a string ("10.10.0.0/22").
    pub cidr: String,
    /// DNS resolvers as plain IP strings (no /32 suffix).
    pub dns_servers: Vec<String>,
    pub mtu: i32,
    pub is_active: bool,
}

impl From<Server> for AdminServer {
    fn from(s: Server) -> Self {
        Self {
            id: s.id,
            name: s.name,
            region: s.region,
            endpoint_host: s.endpoint_host,
            endpoint_port: s.endpoint_port,
            public_key: s.public_key,
            cidr: s.cidr.to_string(),
            dns_servers: s.dns_servers.into_iter().map(|n| n.ip().to_string()).collect(),
            mtu: s.mtu,
            is_active: s.is_active,
        }
    }
}

#[utoipa::path(
    get,
    path = "/admin/servers",
    tag = "Admin",
    responses(
        (status = 200, description = "Active WG servers", body = Vec<AdminServer>),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn list_servers(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
) -> ApiResult<impl IntoResponse> {
    let rows = servers::list_active(&state.pool).await?;
    let out: Vec<AdminServer> = rows.into_iter().map(Into::into).collect();
    Ok(Json(out))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchServerBody {
    pub endpoint_host: Option<String>,
    pub endpoint_port: Option<i32>,
    pub mtu: Option<i32>,
    pub dns_servers: Option<Vec<String>>,
}

#[utoipa::path(
    patch,
    path = "/admin/servers/{id}",
    tag = "Admin",
    params(
        ("id" = Uuid, Path, description = "Server UUID"),
    ),
    request_body = PatchServerBody,
    responses(
        (status = 200, description = "Server config updated", body = StatusAck),
        (status = 400, description = "Validation error (port / MTU / DNS shape)"),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn patch_server(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchServerBody>,
) -> ApiResult<impl IntoResponse> {
    if let Some(port) = body.endpoint_port {
        if !(1..=65535).contains(&port) {
            return Err(ApiError::Validation("endpoint_port must be 1..=65535".into()));
        }
    }
    if let Some(mtu) = body.mtu {
        if !(576..=9000).contains(&mtu) {
            return Err(ApiError::Validation("mtu must be 576..=9000".into()));
        }
    }
    let dns_parsed: Option<Vec<IpNetwork>> = match body.dns_servers.as_ref() {
        Some(list) => {
            let mut out = Vec::with_capacity(list.len());
            for s in list {
                let ip: std::net::IpAddr = s
                    .parse()
                    .map_err(|_| ApiError::Validation(format!("invalid DNS IP: {s}")))?;
                out.push(IpNetwork::from(ip));
            }
            Some(out)
        }
        None => None,
    };
    sqlx::query(
        r#"UPDATE servers
           SET endpoint_host = COALESCE($2, endpoint_host),
               endpoint_port = COALESCE($3, endpoint_port),
               mtu           = COALESCE($4, mtu),
               dns_servers   = COALESCE($5, dns_servers)
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(&body.endpoint_host)
    .bind(body.endpoint_port)
    .bind(body.mtu)
    .bind(dns_parsed)
    .execute(&state.pool)
    .await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.server_patched",
            target_type: Some("server"),
            target_id: Some(id),
            metadata: json!({
                "endpoint_host": body.endpoint_host,
                "endpoint_port": body.endpoint_port,
                "mtu": body.mtu,
                "dns_servers": body.dns_servers,
            }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, server = %id, "server patched");
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RotateServerAck {
    #[schema(example = "ok")]
    pub status: &'static str,
    pub new_public_key: String,
    pub wg0_conf_rewritten: bool,
    pub warning: String,
}

#[utoipa::path(
    post,
    path = "/admin/servers/{id}/rotate-keys",
    tag = "Admin",
    params(
        ("id" = Uuid, Path, description = "Server UUID"),
    ),
    responses(
        (status = 200, description = "Keypair rotated; every peer .conf is now stale", body = RotateServerAck),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "Server not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn rotate_server_keys(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let server = servers::find_by_id(&state.pool, id)
        .await?
        .ok_or(ApiError::NotFound)?;

    let private = zerovpn_wg::keys::generate_private_key();
    let public = zerovpn_wg::keys::derive_public_key(&private)
        .map_err(|e| ApiError::Internal(format!("derive public key: {e}")))?;

    // 1. Rewrite wg0.conf on the shared volume — the WG container reads the
    //    interface key from this file. The container needs to be restarted
    //    after rotation for the new key to take effect.
    let conf_path = std::env::var("ZEROVPN_WG__SERVER_CONFIG_PATH")
        .unwrap_or_else(|_| "/wg/wg0.conf".to_string());
    let listen_port = server.endpoint_port;
    let server_address = format!("{}/{}", server.cidr.network(), server.cidr.prefix());
    let conf = format!(
        "# Auto-generated by zerovpn-api after key rotation.\n\
         [Interface]\n\
         PrivateKey = {private}\n\
         Address = {server_address}\n\
         ListenPort = {listen_port}\n\
         SaveConfig = false\n\
         PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth+ -j MASQUERADE\n\
         PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth+ -j MASQUERADE\n",
    );
    let conf_write_ok = match tokio::fs::write(&conf_path, conf.as_bytes()).await {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!(?e, path = %conf_path, "wg0.conf rewrite failed during key rotation");
            false
        }
    };

    // 2. Persist the new public key in the DB.
    sqlx::query("UPDATE servers SET public_key = $2 WHERE id = $1")
        .bind(id)
        .bind(&public)
        .execute(&state.pool)
        .await?;

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.server_keys_rotated",
            target_type: Some("server"),
            target_id: Some(id),
            metadata: json!({
                "new_public_key": public,
                "wg0_conf_rewritten": conf_write_ok,
            }),
            ip_prefix: None,
        },
    )
    .await?;

    info!(actor = %actor.id, server = %id, "server keys rotated");
    Ok(Json(json!({
        "status": "ok",
        "new_public_key": public,
        "wg0_conf_rewritten": conf_write_ok,
        "warning": "All peer .conf files reference the OLD server pubkey and must be re-downloaded. Restart the wg container to pick up the new private key.",
    })))
}

// ---- Server detail -------------------------------------------------------

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminServerDeviceRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_email: String,
    pub name: String,
    pub os: zerovpn_core::models::DeviceOs,
    pub status: zerovpn_core::models::DeviceStatus,
    pub allocated_ip: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_handshake_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminServerDetail {
    pub server: AdminServer,
    pub device_count_active: i64,
    pub device_count_paused: i64,
    pub device_count_total: i64,
    pub devices: Vec<AdminServerDeviceRow>,
}

/// Bundled server detail for the admin server-detail page. Server core
/// + per-status device counts + the list of devices on this server
/// joined with each device's owning user email.
#[utoipa::path(
    get,
    path = "/admin/servers/{id}",
    tag = "Admin",
    params(("id" = Uuid, Path, description = "Target server UUID")),
    responses(
        (status = 200, description = "Server detail bundle", body = AdminServerDetail),
        (status = 403, description = "Not an admin"),
        (status = 404, description = "Server not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn server_detail(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let server = servers::find_by_id(&state.pool, id)
        .await?
        .ok_or(ApiError::NotFound)?;

    // One inline query joins devices to users so we can show emails
    // next to each device row without N round trips.
    let device_rows: Vec<AdminServerDeviceRow> = sqlx::query_as::<_, (
        Uuid,
        Uuid,
        String,
        String,
        zerovpn_core::models::DeviceOs,
        zerovpn_core::models::DeviceStatus,
        ipnetwork::IpNetwork,
        Option<OffsetDateTime>,
        OffsetDateTime,
    )>(
        r#"SELECT d.id, d.user_id, u.email::TEXT, d.name, d.os, d.status,
                  d.allocated_ip, d.last_handshake_at, d.created_at
             FROM devices d
             JOIN users u ON u.id = d.user_id
            WHERE d.server_id = $1 AND d.status <> 'revoked'
            ORDER BY d.created_at DESC
            LIMIT 200"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|r| AdminServerDeviceRow {
        id: r.0,
        user_id: r.1,
        user_email: r.2,
        name: r.3,
        os: r.4,
        status: r.5,
        allocated_ip: r.6.ip().to_string(),
        last_handshake_at: r.7,
        created_at: r.8,
    })
    .collect();

    // Per-status counts via a single CASE-aggregating query — cheaper
    // than two round trips and consistent with the user-detail row.
    let counts: (i64, i64, i64) = sqlx::query_as(
        r#"SELECT
              COUNT(*) FILTER (WHERE status = 'active')::BIGINT  AS active,
              COUNT(*) FILTER (WHERE status = 'paused')::BIGINT  AS paused,
              COUNT(*) FILTER (WHERE status <> 'revoked')::BIGINT AS total
             FROM devices WHERE server_id = $1"#,
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(AdminServerDetail {
        server: AdminServer::from(server),
        device_count_active: counts.0,
        device_count_paused: counts.1,
        device_count_total: counts.2,
        devices: device_rows,
    }))
}

#[utoipa::path(
    get,
    path = "/admin/servers/{id}/bandwidth",
    tag = "Admin",
    params(
        ("id" = Uuid, Path, description = "Target server UUID"),
        BandwidthRangeQuery,
    ),
    responses(
        (status = 200, description = "Bucketed RX/TX history aggregated across the server's devices", body = AdminUserBandwidthResponse),
        (status = 400, description = "Invalid range"),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn server_bandwidth(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Path(id): Path<Uuid>,
    Query(q): Query<BandwidthRangeQuery>,
) -> ApiResult<impl IntoResponse> {
    let range = q.range.unwrap_or_else(|| "24h".into());
    let (since, bucket) = match range.as_str() {
        "24h" => (OffsetDateTime::now_utc() - time::Duration::hours(24), "hour"),
        "7d" => (OffsetDateTime::now_utc() - time::Duration::days(7), "hour"),
        "30d" => (OffsetDateTime::now_utc() - time::Duration::days(30), "day"),
        other => {
            return Err(ApiError::Validation(format!(
                "range must be 24h | 7d | 30d (got {other})"
            )));
        }
    };
    let rows = bandwidth::server_totals(&state.pool, id, since, bucket).await?;
    Ok(Json(AdminUserBandwidthResponse {
        bucket: if bucket == "hour" { "hour" } else { "day" },
        range,
        buckets: rows
            .into_iter()
            .map(|b| AdminUserBandwidthBucket {
                bucket_start: b.bucket_start,
                rx_bytes: b.rx_bytes,
                tx_bytes: b.tx_bytes,
            })
            .collect(),
    }))
}

/// Admin-only: every non-revoked device across the deployment, used to
/// render the fleet-wide topology view. Each row carries its owning
/// `user_id` so the frontend can cluster devices under their user node.
#[utoipa::path(
    get,
    path = "/admin/devices",
    tag = "Admin",
    responses(
        (status = 200, description = "All non-revoked devices (every user)", body = Vec<PublicDevice>),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn list_devices(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
) -> ApiResult<impl IntoResponse> {
    let rows = devices::list_all_active(&state.pool).await?;
    let out: Vec<PublicDevice> = rows.into_iter().map(Into::into).collect();
    Ok(Json(out))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminStatsResponse {
    pub total: i64,
    pub active: i64,
    pub suspended: i64,
    pub pending_verification: i64,
    pub devices_total: i64,
}

/// Deployment-wide user + device counts. Powers the admin overview KPI
/// strip; replaces the previous client-side counts which were bounded to
/// whatever page of the user list the admin was looking at.
#[utoipa::path(
    get,
    path = "/admin/stats",
    tag = "Admin",
    responses(
        (status = 200, description = "Aggregate user + device counts", body = AdminStatsResponse),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn stats(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
) -> ApiResult<impl IntoResponse> {
    let s = users::admin_stats(&state.pool).await?;
    Ok(Json(AdminStatsResponse {
        total: s.total,
        active: s.active,
        suspended: s.suspended,
        pending_verification: s.pending_verification,
        devices_total: s.devices_total,
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminFleetBandwidthResponse {
    /// All-time bytes received by every user's devices.
    pub rx_bytes: i64,
    /// All-time bytes transmitted by every user's devices.
    pub tx_bytes: i64,
}

/// Fleet-wide all-time bandwidth. Pulled from the hourly
/// `bandwidth_aggregates` rollups so the value survives reloads and
/// doesn't depend on a live WS connection.
#[utoipa::path(
    get,
    path = "/admin/bandwidth",
    tag = "Admin",
    responses(
        (status = 200, description = "Fleet RX/TX totals", body = AdminFleetBandwidthResponse),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn fleet_bandwidth(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
) -> ApiResult<impl IntoResponse> {
    let (rx_bytes, tx_bytes) = bandwidth::fleet_totals(&state.pool).await?;
    Ok(Json(AdminFleetBandwidthResponse { rx_bytes, tx_bytes }))
}

// --- Impersonation ---------------------------------------------------------

/// Begin impersonating a user. Swaps the session's `user_id` to the target
/// while saving the admin's real identity under `real_user_id` so it can be
/// restored when impersonation ends. Requires admin role.
pub async fn impersonate_user(
    State(state): State<AppState>,
    RequireAdmin(actor): RequireAdmin,
    session: Session,
    Path(target_id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    if target_id == actor.id {
        return Err(ApiError::Validation("cannot impersonate yourself".into()));
    }

    let target = users::find_by_id(&state.pool, target_id)
        .await?
        .ok_or(ApiError::NotFound)?;

    if target.status != UserStatus::Active {
        return Err(ApiError::Validation(
            "can only impersonate active users".into(),
        ));
    }

    // Preserve the admin's real identity so we can restore it later.
    session
        .insert(SESSION_KEY_REAL_USER_ID, actor.id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    session
        .insert(
            SESSION_KEY_REAL_PW_CHANGED_AT,
            actor.password_changed_at.unix_timestamp(),
        )
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    // Swap to the target user.
    session
        .insert(SESSION_KEY_USER_ID, target.id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    session
        .insert(
            SESSION_KEY_PW_CHANGED_AT,
            target.password_changed_at.unix_timestamp(),
        )
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(actor.id),
            action: "admin.impersonate_start",
            target_type: Some("user"),
            target_id: Some(target_id),
            metadata: json!({ "target_email": target.email }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(actor = %actor.id, target = %target_id, "admin started impersonation");

    Ok(Json(json!({ "status": "ok" })))
}

/// Stop impersonating. Restores the admin's real session identity.
/// Does not require `RequireAdmin` because the active session now belongs
/// to the impersonated (possibly non-admin) user.
pub async fn stop_impersonation(
    State(state): State<AppState>,
    session: Session,
) -> ApiResult<impl IntoResponse> {
    let real_user_id: Option<Uuid> = session
        .get(SESSION_KEY_REAL_USER_ID)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let real_user_id =
        real_user_id.ok_or_else(|| ApiError::Validation("not in an impersonated session".into()))?;

    let real_pw: Option<i64> = session
        .get(SESSION_KEY_REAL_PW_CHANGED_AT)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let real_pw = real_pw.ok_or_else(|| ApiError::Internal("missing real pw watermark".into()))?;

    // Restore the admin's identity.
    session
        .insert(SESSION_KEY_USER_ID, real_user_id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    session
        .insert(SESSION_KEY_PW_CHANGED_AT, real_pw)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    // Clear impersonation keys.
    session
        .remove::<Uuid>(SESSION_KEY_REAL_USER_ID)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    session
        .remove::<i64>(SESSION_KEY_REAL_PW_CHANGED_AT)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(real_user_id),
            action: "admin.impersonate_stop",
            target_type: None,
            target_id: None,
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    info!(admin = %real_user_id, "admin stopped impersonation");

    Ok(Json(json!({ "status": "ok" })))
}
