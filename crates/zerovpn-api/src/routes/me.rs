use std::collections::HashMap;

use axum::{Json, extract::State, http::HeaderMap, response::IntoResponse};
use garde::Validate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tower_sessions::Session;
use tracing::{info, warn};
use utoipa::ToSchema;
use zerovpn_db::repos::{
    audit, devices, servers, session_events, topology_positions, user_prefs, users,
};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::{CurrentUser, SESSION_KEY_PW_CHANGED_AT},
    routes::dto::StatusAck,
    state::AppState,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct DataExport {
    #[serde(with = "time::serde::rfc3339")]
    pub generated_at: OffsetDateTime,
    /// The authenticated user's `User` row (no password / TOTP material).
    pub user: serde_json::Value,
    /// Every device owned by the user, regardless of status.
    pub devices: serde_json::Value,
    /// Audit entries this user authored. Admin-target rows on this user
    /// are deliberately excluded from this scope.
    pub audit: serde_json::Value,
}

/// GDPR data export: returns a JSON blob with everything we have on the
/// authenticated user, excluding password hashes / TOTP secrets.
#[utoipa::path(
    get,
    path = "/me/data-export",
    tag = "Account",
    responses(
        (status = 200, description = "User-scoped data export", body = DataExport),
        (status = 401, description = "No session"),
    ),
    security(("session_cookie" = [])),
)]
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

#[derive(Debug, Serialize, ToSchema)]
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
#[utoipa::path(
    get,
    path = "/me/server",
    tag = "Account",
    responses(
        (status = 200, description = "Public WG server defaults for the create-device dialog", body = MyServerInfo),
        (status = 404, description = "No active server yet"),
    ),
    security(("session_cookie" = [])),
)]
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

#[derive(Debug, Serialize, ToSchema)]
pub struct TopologyPositionsResponse {
    pub positions: HashMap<String, Pos>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct Pos {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TopologyPositionsRequest {
    pub positions: HashMap<String, Pos>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TopologyAck {
    #[schema(example = "ok")]
    pub status: &'static str,
    /// Number of (node_id, x, y) rows actually persisted after server-
    /// side sanitisation (non-finite coords + over-long ids are dropped).
    pub count: usize,
}

#[utoipa::path(
    get,
    path = "/me/topology",
    tag = "Account",
    responses(
        (status = 200, description = "Saved node positions for the live topology", body = TopologyPositionsResponse),
    ),
    security(("session_cookie" = [])),
)]
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

#[utoipa::path(
    put,
    path = "/me/topology",
    tag = "Account",
    request_body = TopologyPositionsRequest,
    responses(
        (status = 200, description = "Positions persisted (count = rows actually written)", body = TopologyAck),
        (status = 400, description = "Too many entries"),
    ),
    security(("session_cookie" = [])),
)]
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
#[utoipa::path(
    get,
    path = "/me/preferences",
    tag = "Account",
    responses(
        (status = 200, description = "Current preferences (defaults if never saved)", body = user_prefs::UserPreferences),
    ),
    security(("session_cookie" = [])),
)]
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
#[utoipa::path(
    put,
    path = "/me/preferences",
    tag = "Account",
    request_body = user_prefs::UserPreferencesPatch,
    responses(
        (status = 200, description = "Patched preferences (server returns the full merged state)", body = user_prefs::UserPreferences),
        (status = 400, description = "Validation error (unknown enum value)"),
    ),
    security(("session_cookie" = [])),
)]
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
#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct ChangePasswordBody {
    #[garde(length(min = 1))]
    pub current_password: String,
    #[garde(length(min = 12, max = 128))]
    pub new_password: String,
}

/// Authenticated change-password: verifies the current password and sets
/// a new one. `update_password` bumps `password_changed_at` which would
/// invalidate this very request's session on the next hop, so we
/// re-snapshot the new watermark into the current session — the user
/// stays signed in here while every *other* session for this account
/// dies on its next request.
#[utoipa::path(
    post,
    path = "/me/change-password",
    tag = "Account",
    request_body = ChangePasswordBody,
    responses(
        (status = 200, description = "Password rotated; this session is kept alive while every other session for the user dies on next request", body = StatusAck),
        (status = 400, description = "Wrong current password / new == current / new too short"),
        (status = 401, description = "No session"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn change_password(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    session: Session,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;
    if body.current_password == body.new_password {
        return Err(ApiError::Validation(
            "new password must differ from current password".into(),
        ));
    }

    let current_hash = users::find_password_hash(&state.pool, user.id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let ok = zerovpn_auth::password::verify(&body.current_password, &current_hash)?;
    if !ok {
        return Err(ApiError::Validation("current password is incorrect".into()));
    }

    let new_hash = zerovpn_auth::password::hash(&body.new_password)?;
    users::update_password(&state.pool, user.id, &new_hash).await?;

    // Re-sync the current session's password-watermark snapshot so the
    // request that just changed the password is not itself logged out.
    if let Some(new_watermark) = users::find_password_changed_at(&state.pool, user.id).await? {
        session
            .insert(SESSION_KEY_PW_CHANGED_AT, new_watermark.unix_timestamp())
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
    }

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "user.password_changed",
            target_type: Some("user"),
            target_id: Some(user.id),
            metadata: json!({}),
            ip: None,
        },
    )
    .await?;
    // Phase 2 / Stage B — session_events row.
    if let Err(e) = session_events::record(
        &state.pool,
        user.id,
        session_events::SessionEvent::PasswordChange,
        crate::routes::auth::client_ip(&headers),
        crate::routes::auth::client_user_agent(&headers).as_deref(),
        json!({ "via": "settings" }),
    )
    .await
    {
        warn!(?e, user_id = %user.id, "session_events password_change record failed");
    }
    info!(user_id = %user.id, "password changed");
    Ok(Json(json!({ "status": "ok" })))
}

/// "Sign out everywhere" — bumps the user's password-watermark which
/// invalidates every session except the current one (we re-sync the
/// snapshot in this session so the caller stays signed in). No password
/// change happens; the hash is untouched. Used by the Security panel.
#[utoipa::path(
    post,
    path = "/me/sessions/revoke-all",
    tag = "Account",
    responses(
        (status = 200, description = "All other sessions invalidated; this session kept alive", body = StatusAck),
        (status = 401, description = "No session"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn revoke_other_sessions(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    session: Session,
) -> ApiResult<impl IntoResponse> {
    users::kill_all_sessions(&state.pool, user.id).await?;
    if let Some(new_watermark) = users::find_password_changed_at(&state.pool, user.id).await? {
        session
            .insert(SESSION_KEY_PW_CHANGED_AT, new_watermark.unix_timestamp())
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
    }
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "user.sessions_revoked",
            target_type: Some("user"),
            target_id: Some(user.id),
            metadata: json!({}),
            ip: None,
        },
    )
    .await?;
    info!(user_id = %user.id, "user revoked all other sessions");
    Ok(Json(json!({ "status": "ok" })))
}

#[utoipa::path(
    delete,
    path = "/me/account",
    tag = "Account",
    responses(
        (status = 200, description = "Account soft-deleted, devices revoked, session flushed", body = StatusAck),
        (status = 401, description = "No session"),
    ),
    security(("session_cookie" = [])),
)]
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
            ip: None,
        },
    )
    .await?;
    let _ = session.flush().await;

    // Tear down the live WG peers AND release device IPs from the
    // in-memory allocator. Both are best-effort: log on failure but
    // never abort the deletion (DB is already updated).
    if let Ok(user_devices) = devices::list_for_user(&state.pool, user.id).await {
        for d in user_devices {
            if d.status == zerovpn_core::models::DeviceStatus::Active {
                if let Err(e) = state.wg.remove_peer(&d.public_key).await {
                    tracing::warn!(?e, device_id = %d.id, "delete_account: wg remove_peer failed");
                }
            }
            if let Some(alloc) = state.allocators.get(d.server_id) {
                let _ = alloc.release(d.allocated_ip.ip());
            }
        }
    }

    info!(user_id = %user.id, "account soft-deleted");
    Ok(Json(json!({ "status": "ok" })))
}
