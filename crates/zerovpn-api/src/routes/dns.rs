use std::{collections::HashSet, path::PathBuf};

use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::info;
use utoipa::ToSchema;
use uuid::Uuid;
use zerovpn_db::repos::{audit, devices};
use zerovpn_dns::{PeerDnsEntry, validate_hostname, write_hosts_file};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::CurrentUser,
    state::AppState,
};

const MAX_DNS_NAMES_PER_DEVICE: usize = 4;

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetDnsBody {
    pub dns_names: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DnsResponse {
    pub dns_names: Vec<String>,
}

#[utoipa::path(
    put,
    path = "/devices/{id}/dns",
    tag = "Devices",
    params(("id" = uuid::Uuid, Path, description = "Device UUID")),
    request_body = SetDnsBody,
    responses(
        (status = 200, description = "DNS names updated", body = DnsResponse),
        (status = 400, description = "Validation error"),
        (status = 404, description = "Device not found"),
        (status = 409, description = "DNS name already in use"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn set(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SetDnsBody>,
) -> ApiResult<impl IntoResponse> {
    if body.dns_names.len() > MAX_DNS_NAMES_PER_DEVICE {
        return Err(ApiError::Validation(format!(
            "max {MAX_DNS_NAMES_PER_DEVICE} DNS names per device"
        )));
    }

    let device = devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;

    let mut wanted: Vec<String> = Vec::with_capacity(body.dns_names.len());
    for name in &body.dns_names {
        let name = name.trim().to_lowercase();
        validate_hostname(&name).map_err(|e| ApiError::Validation(e.to_string()))?;
        if !wanted.contains(&name) {
            wanted.push(name);
        }
    }

    // Uniqueness across the deployment, ignoring this device's own existing
    // names. App-layer enforcement until 1B's side-table.
    let all = devices::all_dns_names(&state.pool).await?;
    let already_owned: HashSet<&str> =
        device.dns_names.iter().map(String::as_str).collect();
    for n in &wanted {
        if !already_owned.contains(n.as_str()) && all.iter().any(|x| x == n) {
            return Err(ApiError::Conflict(format!("DNS name '{n}' already in use")));
        }
    }

    devices::set_dns_names(&state.pool, user.id, id, &wanted).await?;

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.dns_updated",
            target_type: Some("device"),
            target_id: Some(id),
            metadata: json!({ "dns_names": wanted }),
            ip: None,
        },
    )
    .await?;

    // Regenerate the dnsmasq hosts file with all current entries.
    if let Err(e) = sync_dnsmasq(&state.pool).await {
        // Don't fail the whole request — log and continue. Dnsmasq will be
        // re-synced on next change.
        tracing::warn!(?e, "dnsmasq sync failed");
    }

    info!(user_id = %user.id, device_id = %id, count = wanted.len(), "dns names updated");
    Ok(Json(DnsResponse { dns_names: wanted }))
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct CheckQuery {
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CheckResponse {
    /// True iff the candidate name matches the server's hostname regex.
    pub valid: bool,
    /// True iff the candidate is both valid and not currently held by
    /// any device in the deployment. Always false when `valid` is false.
    pub available: bool,
    /// Short reason when not available (e.g. "invalid", "taken").
    /// Omitted on `available: true`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Pre-flight DNS-name availability probe. Used by the create-device
/// dialog so the user knows before submit whether their requested
/// `<device>.<user>.vpn.local` collides with another peer. Cheap: a
/// regex check + one indexed list of every existing dns_name. Safe to
/// call repeatedly (debounced from the client side).
#[utoipa::path(
    get,
    path = "/devices/dns-check",
    tag = "Devices",
    params(CheckQuery),
    responses(
        (status = 200, description = "Availability probe result", body = CheckResponse),
    ),
    security(("session_cookie" = [])),
)]
pub async fn check_availability(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Query(q): Query<CheckQuery>,
) -> ApiResult<impl IntoResponse> {
    let name = q.name.trim().to_lowercase();
    if validate_hostname(&name).is_err() {
        return Ok(Json(CheckResponse {
            valid: false,
            available: false,
            reason: Some("invalid".into()),
        }));
    }
    let all = devices::all_dns_names(&state.pool).await?;
    let taken = all.iter().any(|n| n == &name);
    if taken {
        return Ok(Json(CheckResponse {
            valid: true,
            available: false,
            reason: Some("taken".into()),
        }));
    }
    Ok(Json(CheckResponse {
        valid: true,
        available: true,
        reason: None,
    }))
}

async fn sync_dnsmasq(pool: &zerovpn_db::PgPool) -> anyhow::Result<()> {
    let path: PathBuf = std::env::var("ZEROVPN_WG__DNSMASQ_HOSTS_FILE")
        .unwrap_or_else(|_| "/etc/dnsmasq.d/zerovpn-peers.conf".to_string())
        .into();
    let entries: Vec<PeerDnsEntry> = devices::list_active_with_dns(pool)
        .await?
        .into_iter()
        .flat_map(|(_id, ip, names)| {
            names.into_iter().map(move |n| PeerDnsEntry { name: n, ip })
        })
        .collect();
    write_hosts_file(&path, &entries).await?;
    Ok(())
}
