use std::collections::HashMap;

use axum::{Json, extract::State, response::IntoResponse};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tower_sessions::Session;
use tracing::info;
use zerovpn_db::repos::{audit, devices, servers, topology_positions, user_prefs, users};

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

// ── Topology positions ──────────────────────────────────────────────────
// Per-user saved node positions for the live-topology drag UI. Stored as
// rows in topology_positions, serialised over the wire as a flat
// {node_id: {x, y}} object — same shape the frontend uses in localStorage.

#[derive(Debug, Serialize)]
pub struct TopologyPositionsResponse {
    pub positions: HashMap<String, Pos>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Pos {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Deserialize)]
pub struct TopologyPositionsRequest {
    pub positions: HashMap<String, Pos>,
}

pub async fn get_topology(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    let rows = topology_positions::get_all(&state.pool, user.id).await?;
    let mut positions = HashMap::new();
    for r in rows {
        // Drop non-finite values defensively — should never happen since
        // we reject them on write, but a bad row from an older client
        // shouldn't poison the chart.
        if !r.x.is_finite() || !r.y.is_finite() {
            continue;
        }
        positions.insert(r.node_id, Pos { x: r.x, y: r.y });
    }
    Ok(Json(TopologyPositionsResponse { positions }))
}

pub async fn set_topology(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<TopologyPositionsRequest>,
) -> ApiResult<impl IntoResponse> {
    // Sanitize: skip non-finite coords, cap the number of entries so a
    // misbehaving client can't fill our table with a million bogus rows.
    const MAX_ENTRIES: usize = 1024;
    if body.positions.len() > MAX_ENTRIES {
        return Err(ApiError::Validation(format!(
            "too many positions ({} > {})",
            body.positions.len(),
            MAX_ENTRIES
        )));
    }
    let mut clean: Vec<topology_positions::Position> = Vec::with_capacity(body.positions.len());
    for (node_id, pos) in body.positions {
        if !pos.x.is_finite() || !pos.y.is_finite() {
            continue;
        }
        // node_id length cap so a malicious client can't bloat rows with
        // arbitrarily long strings. UUID (36) + sentinel ("__hub__") fit
        // comfortably below 64.
        if node_id.is_empty() || node_id.len() > 64 {
            continue;
        }
        clean.push(topology_positions::Position {
            node_id,
            x: pos.x,
            y: pos.y,
        });
    }
    topology_positions::replace_all(&state.pool, user.id, &clean).await?;
    Ok(Json(json!({ "status": "ok", "count": clean.len() })))
}

/// Returns the user's settings-page preferences. Falls through to
/// defaults for users who've never saved — the next PUT creates the row.
pub async fn get_preferences(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    let prefs = user_prefs::get(&state.pool, user.id).await?;
    Ok(Json(prefs))
}

/// Partial update of the user's preferences. Validates the constrained
/// text fields against the same set the DB CHECK enforces so we can
/// surface a clean 400 instead of a sqlx error if a future client sends
/// a stray value.
pub async fn set_preferences(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(patch): Json<user_prefs::UserPreferencesPatch>,
) -> ApiResult<impl IntoResponse> {
    if let Some(v) = patch.units.as_deref() {
        if !matches!(v, "bps" | "Bps") {
            return Err(ApiError::Validation(format!("invalid units: {v}")));
        }
    }
    if let Some(v) = patch.date_format.as_deref() {
        if !matches!(v, "iso" | "us" | "eu") {
            return Err(ApiError::Validation(format!("invalid date_format: {v}")));
        }
    }
    if let Some(v) = patch.time_format.as_deref() {
        if !matches!(v, "h24" | "h12") {
            return Err(ApiError::Validation(format!("invalid time_format: {v}")));
        }
    }
    if let Some(v) = patch.default_landing.as_deref() {
        if !matches!(v, "dashboard" | "devices" | "topology") {
            return Err(ApiError::Validation(format!(
                "invalid default_landing: {v}"
            )));
        }
    }
    if let Some(v) = patch.toast_position.as_deref() {
        if !matches!(
            v,
            "top-left"
                | "top-center"
                | "top-right"
                | "bottom-left"
                | "bottom-center"
                | "bottom-right"
        ) {
            return Err(ApiError::Validation(format!(
                "invalid toast_position: {v}"
            )));
        }
    }
    let prefs = user_prefs::upsert(&state.pool, user.id, &patch).await?;
    Ok(Json(prefs))
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
