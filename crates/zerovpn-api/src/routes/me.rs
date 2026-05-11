use axum::{Json, extract::State, response::IntoResponse};
use serde::Serialize;
use serde_json::json;
use time::OffsetDateTime;
use tower_sessions::Session;
use tracing::info;
use zerovpn_db::repos::{audit, devices, servers, users};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::CurrentUser,
    state::AppState,
};

#[derive(Debug, Serialize)]
pub struct DataExport {
    pub generated_at: OffsetDateTime,
    pub user: serde_json::Value,
    pub devices: serde_json::Value,
    pub audit: serde_json::Value,
}

/// GDPR data export: returns a JSON blob with everything we have on the
/// authenticated user, excluding password hashes / TOTP secrets.
pub async fn export(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    // User row (already public-safe via the User type)
    let user_json = serde_json::to_value(&user)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    // All devices owned by user (regardless of status)
    let devs = sqlx::query_as::<_, zerovpn_core::models::Device>(
        r#"SELECT id, user_id, server_id, name, os, public_key, allocated_ip, status,
                  dns_names, allowed_ips_override, dns_override,
                  last_handshake_at, created_at
             FROM devices
            WHERE user_id = $1
            ORDER BY created_at DESC"#,
    )
    .bind(user.id)
    .fetch_all(&state.pool)
    .await?;
    let devices_json = serde_json::to_value(&devs)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    // Audit entries the user is the actor of (admins also have entries on
    // them as targets, but we keep this scoped to actor for the user's
    // own export).
    #[derive(serde::Serialize, sqlx::FromRow)]
    struct AuditEntry {
        action: String,
        target_type: Option<String>,
        target_id: Option<uuid::Uuid>,
        metadata: serde_json::Value,
        created_at: OffsetDateTime,
    }
    let entries: Vec<AuditEntry> = sqlx::query_as(
        r#"SELECT action, target_type, target_id, metadata, created_at
             FROM audit_logs
            WHERE actor_user_id = $1
            ORDER BY id DESC"#,
    )
    .bind(user.id)
    .fetch_all(&state.pool)
    .await?;
    let audit_json = serde_json::to_value(&entries)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let device_count = devs.len();
    let entry_count = entries.len();
    drop(devs);
    drop(entries);
    info!(user_id = %user.id, devices = device_count, audit = entry_count, "data export");
    Ok(Json(DataExport {
        generated_at: OffsetDateTime::now_utc(),
        user: user_json,
        devices: devices_json,
        audit: audit_json,
    }))
}

#[derive(Debug, Serialize)]
pub struct MyServerInfo {
    /// CIDR of the WG subnet (e.g. "10.10.0.0/22"). Used by the create-
    /// device dialog to render "must be inside <cidr>" hints and to
    /// pre-fill the split-tunnel allowed_ips.
    pub cidr: String,
    /// Default DNS resolvers (e.g. ["10.10.0.1"]). Pre-filled as the
    /// initial value for the create-device "custom DNS" field so users
    /// don't have to guess.
    pub dns_servers: Vec<String>,
    /// Public hostname:port the user's clients dial. Echoed back so
    /// the create dialog can show "you'll connect via <host>".
    pub endpoint_host: String,
    pub endpoint_port: i32,
    pub mtu: i32,
}

/// Public-safe info about the user's WG server. Exposes the same values
/// that already end up in every `.conf` file the user downloads — no
/// secrets (private keys, internal kek, etc) are included. Anyone with
/// a valid session can call this.
pub async fn server_info(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    let active = servers::list_active(&state.pool).await?;
    let s = active.into_iter().next().ok_or(ApiError::NotFound)?;
    Ok(Json(MyServerInfo {
        cidr: format!("{}/{}", s.cidr.network(), s.cidr.prefix()),
        dns_servers: s
            .dns_servers
            .iter()
            .map(|n| n.ip().to_string())
            .collect(),
        endpoint_host: s.endpoint_host,
        endpoint_port: s.endpoint_port,
        mtu: s.mtu,
    }))
}

/// Soft-delete the user's account: nulls PII, revokes devices/sessions/
/// tokens, flushes the current session.
pub async fn delete_account(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    session: Session,
) -> ApiResult<impl IntoResponse> {
    users::soft_delete(&state.pool, user.id).await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "user.deleted",
            target_type: Some("user"),
            target_id: Some(user.id),
            metadata: serde_json::json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    let _ = session.flush().await;

    // Belt-and-suspenders: revoke any device IPs from the in-memory bitmap.
    if let Ok(user_devices) = devices::list_for_user(&state.pool, user.id).await {
        for d in user_devices {
            if let std::net::IpAddr::V4(v4) = d.allocated_ip.ip() {
                if let Some(alloc) = state.allocators.get(d.server_id) {
                    let _ = alloc.release(v4);
                }
            }
        }
    }

    info!(user_id = %user.id, "account soft-deleted");
    Ok(Json(json!({ "status": "ok" })))
}
