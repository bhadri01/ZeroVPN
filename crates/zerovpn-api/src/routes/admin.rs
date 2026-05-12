use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tracing::info;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use zerovpn_core::models::{Server, UserRole, UserStatus};
use zerovpn_db::repos::{audit, bandwidth, servers, users};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::RequireAdmin,
    routes::dto::StatusAck,
    state::AppState,
};

#[derive(Debug, Deserialize, IntoParams)]
pub struct ListQuery {
    /// Free-text email search (substring, case-insensitive).
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}
fn default_limit() -> i64 { 50 }

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

#[derive(Debug, Deserialize, IntoParams)]
pub struct AuditQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    /// Optional action filter, e.g. "device.created".
    #[serde(default)]
    pub action: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct AuditRow {
    pub id: i64,
    pub actor_user_id: Option<Uuid>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub metadata: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AuditList {
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

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct FailedLoginRow {
    pub id: i64,
    pub email_attempted: Option<String>,
    pub reason: zerovpn_db::repos::failed_logins::FailedLoginReason,
    #[serde(with = "time::serde::rfc3339")]
    pub attempted_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FailedLoginList {
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
    /// Total bytes received by every user's devices in the window.
    pub rx_bytes: i64,
    /// Total bytes transmitted by every user's devices in the window.
    pub tx_bytes: i64,
    /// Length of the window in days. Always 30 for now; exposed so the
    /// frontend can label the card honestly if the value ever changes.
    pub window_days: i64,
}

/// Fleet-wide bandwidth over the last 30 days. Pulled from the hourly
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
    let window_days = 30i64;
    let since = OffsetDateTime::now_utc() - time::Duration::days(window_days);
    let (rx_bytes, tx_bytes) = bandwidth::fleet_totals(&state.pool, since).await?;
    Ok(Json(AdminFleetBandwidthResponse {
        rx_bytes,
        tx_bytes,
        window_days,
    }))
}
