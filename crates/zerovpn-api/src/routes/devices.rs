use std::{collections::HashMap, net::IpAddr, sync::Arc};

use askama::Template;
use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use garde::Validate;
use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tracing::info;
use utoipa::ToSchema;
use uuid::Uuid;
use zerovpn_core::models::{Device, DeviceOs, DeviceStatus, DeviceType};
use zerovpn_db::repos::{audit, devices, servers};
use zerovpn_wg::{config, ip_alloc::IpAllocator, keys, qr};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::CurrentUser,
    routes::dto::StatusAck,
    state::AppState,
};

const MAX_DEVICES_PER_USER: usize = 5;
pub const PERSISTENT_KEEPALIVE: u16 = 25;

#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct CreateBody {
    #[garde(length(min = 1, max = 64))]
    pub name: String,
    #[garde(skip)]
    pub os: Option<DeviceOs>,
    /// Device form factor (phone, tablet, laptop, …). Independent of `os`.
    #[garde(skip)]
    pub device_type: Option<DeviceType>,
    /// When true, the generated config restricts AllowedIPs to RFC1918
    /// private subnets — the user's other traffic exits via their LAN.
    #[garde(skip)]
    pub split_tunnel: Option<bool>,
    /// Optional custom DNS resolvers. Each must parse as an IPv4 or IPv6
    /// address; rejected if any entry is malformed.
    #[garde(skip)]
    pub dns_override: Option<Vec<String>>,
    /// Optional caller-supplied address. When set, the API tries to
    /// reserve exactly this IP in the server's CIDR rather than picking
    /// the next free one. Returns 409 if the address is taken or
    /// reserved (network / broadcast / gateway), 400 if it parses but
    /// isn't inside the server's CIDR.
    #[garde(skip)]
    pub allocated_ip: Option<String>,
    /// When true, the API encrypts the generated WG private key with
    /// the server KEK and persists it on the device row, enabling later
    /// re-download of the .conf via `GET /devices/{id}/conf`. Default
    /// false (zero-knowledge — the key only appears in the create-time
    /// response, then it's gone).
    #[garde(skip)]
    pub store_private_key: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreatedDevice {
    pub device: PublicDevice,
    /// Rendered WireGuard .conf (full text). Shown to the user once at
    /// create / rotate / redownload time.
    pub config: String,
    /// SVG of the .conf as a QR code (for mobile clients).
    pub qr_svg: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PublicDevice {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub os: DeviceOs,
    pub device_type: DeviceType,
    pub public_key: String,
    #[schema(value_type = String, example = "10.10.0.5")]
    pub allocated_ip: IpAddr,
    pub status: DeviceStatus,
    pub server_id: Uuid,
    pub dns_names: Vec<String>,
    pub allowed_ips_override: Option<Vec<String>>,
    pub dns_override: Option<Vec<String>>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_handshake_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// Public `host:port` the peer last connected from, as observed by the
    /// WG poller. `None` until the device's first handshake; persists as
    /// the *last* endpoint after the peer goes offline. Not part of the
    /// core `Device` model — the list/get handlers merge it in (see
    /// `devices::peer_endpoints_for_user`). `None` on create/rotate/admin
    /// responses, which don't fetch it.
    pub last_peer_endpoint: Option<String>,
    /// Wall-clock time `last_peer_endpoint` was first observed.
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_peer_endpoint_at: Option<OffsetDateTime>,
    /// Presence flag only — the device row holds a KEK-encrypted copy of
    /// the WG private key, so the user can re-download the .conf later
    /// via `GET /devices/{id}/conf`. The actual key bytes are never
    /// exposed by this endpoint.
    pub private_key_stored: bool,
}

impl From<Device> for PublicDevice {
    fn from(d: Device) -> Self {
        let dns_override = d
            .dns_override
            .as_ref()
            .map(|v| v.iter().map(|n| n.ip().to_string()).collect());
        let private_key_stored = d.private_key_encrypted.is_some();
        Self {
            id: d.id,
            user_id: d.user_id,
            name: d.name,
            os: d.os,
            device_type: d.device_type,
            public_key: d.public_key,
            allocated_ip: d.allocated_ip.ip(),
            status: d.status,
            server_id: d.server_id,
            dns_names: d.dns_names,
            allowed_ips_override: d.allowed_ips_override,
            dns_override,
            last_handshake_at: d.last_handshake_at,
            created_at: d.created_at,
            // Endpoint columns aren't on the core Device row; handlers that
            // want them merge them in after the conversion.
            last_peer_endpoint: None,
            last_peer_endpoint_at: None,
            private_key_stored,
        }
    }
}

/// The VPN's own subnet — used when `split_tunnel = true` so only traffic
/// to the VPN server (`10.10.0.1`) and other peers routes through the
/// tunnel; everything else (the public internet) uses the client's normal
/// interface. Must stay in sync with the server CIDR allocated in
/// `bootstrap.rs` (`10.10.0.0/22`).
const SPLIT_TUNNEL_ALLOWED_IPS: &str = "10.10.0.0/22";

#[utoipa::path(
    get,
    path = "/devices",
    tag = "Devices",
    responses(
        (status = 200, description = "User's devices in display order", body = Vec<PublicDevice>),
        (status = 401, description = "No session"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    let rows = devices::list_for_user(&state.pool, user.id).await?;
    let mut out: Vec<PublicDevice> = rows.into_iter().map(Into::into).collect();
    // Merge in the WG peer endpoint (latest host:port the poller saw).
    // Kept off the core Device model, so fetched once for the user and
    // zipped onto each card here.
    let endpoints: HashMap<Uuid, (Option<String>, Option<OffsetDateTime>)> =
        devices::peer_endpoints_for_user(&state.pool, user.id)
            .await?
            .into_iter()
            .map(|(id, ep, at)| (id, (ep, at)))
            .collect();
    for d in &mut out {
        if let Some((ep, at)) = endpoints.get(&d.id) {
            d.last_peer_endpoint = ep.clone();
            d.last_peer_endpoint_at = *at;
        }
    }
    Ok(Json(out))
}

#[utoipa::path(
    get,
    path = "/devices/{id}",
    tag = "Devices",
    params(
        ("id" = Uuid, Path, description = "Device UUID"),
    ),
    responses(
        (status = 200, description = "Device row", body = PublicDevice),
        (status = 404, description = "Not found / not owned"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn get(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let d = devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let mut pd = PublicDevice::from(d);
    // Merge in the latest WG peer endpoint (see `list`). ≤5 rows per user,
    // so a single fetch + find is cheaper than its own indexed query.
    if let Some((_, ep, at)) = devices::peer_endpoints_for_user(&state.pool, user.id)
        .await?
        .into_iter()
        .find(|(eid, _, _)| *eid == id)
    {
        pd.last_peer_endpoint = ep;
        pd.last_peer_endpoint_at = at;
    }
    Ok(Json(pd))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeviceEvent {
    pub id: i64,
    pub action: String,
    pub metadata: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: time::OffsetDateTime,
}

#[derive(Debug, Deserialize, Default, utoipa::IntoParams)]
pub struct EventsQuery {
    /// Page size. Clamped to [1, 500] server-side. Defaults to 100 when
    /// omitted — enough to render a full day of typical activity.
    pub limit: Option<i64>,
}

/// Returns the audit-log entries targeting this device, newest first.
/// Powers the device-detail "Activity" timeline: lifecycle events
/// (created / paused / unpaused / revoked), config + DNS changes, key
/// rotations, conf re-downloads, and the worker-emitted online/offline
/// transitions. Ownership is enforced — the caller must own the device.
#[utoipa::path(
    get,
    path = "/devices/{id}/events",
    tag = "Devices",
    params(
        ("id" = Uuid, Path, description = "Device UUID"),
        EventsQuery,
    ),
    responses(
        (status = 200, description = "Audit entries targeting this device, newest first", body = Vec<DeviceEvent>),
        (status = 404, description = "Not found / not owned"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn events(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
    Query(q): Query<EventsQuery>,
) -> ApiResult<impl IntoResponse> {
    // 404 (not 403) for devices the caller doesn't own — keeps the
    // existence of other users' device ids opaque, matching `get`.
    devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let limit = q.limit.unwrap_or(100);
    let rows = audit::list_for_target(&state.pool, "device", id, limit).await?;
    let out: Vec<DeviceEvent> = rows
        .into_iter()
        .map(|r| DeviceEvent {
            id: r.id,
            action: r.action,
            metadata: r.metadata,
            created_at: r.created_at,
        })
        .collect();
    Ok(Json(out))
}

#[utoipa::path(
    post,
    path = "/devices",
    tag = "Devices",
    request_body = CreateBody,
    responses(
        (status = 201, description = "Device created with fresh keypair + .conf + QR (shown ONCE)", body = CreatedDevice),
        (status = 400, description = "Validation error / invalid IP"),
        (status = 409, description = "Per-user device cap hit or chosen IP unavailable"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<CreateBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;

    // Enforce per-user device cap.
    let existing = devices::list_for_user(&state.pool, user.id).await?;
    if existing.len() >= MAX_DEVICES_PER_USER {
        return Err(ApiError::Conflict(format!(
            "max {MAX_DEVICES_PER_USER} active devices per user"
        )));
    }

    // Pick the first active server. Multi-server choice arrives in v2.
    let server = servers::list_active(&state.pool)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::Internal("no active servers".into()))?;

    let alloc = state
        .allocators
        .get(server.id)
        .ok_or_else(|| ApiError::Internal("server allocator missing".into()))?;
    let ip = match body.allocated_ip.as_ref() {
        Some(raw) => reserve_specific(&alloc, raw)?,
        None => allocate_auto(&alloc)?,
    };

    let private_key = keys::generate_private_key();
    let public_key = keys::derive_public_key(&private_key)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    // Opt-in: encrypt the private key with the server KEK so the user can
    // re-download the .conf later. Default behaviour stays zero-knowledge.
    let store_private = body.store_private_key.unwrap_or(false);
    let private_key_encrypted: Option<Vec<u8>> = if store_private {
        Some(
            state
                .kek
                .encrypt(private_key.as_bytes())
                .map_err(|e| ApiError::Internal(format!("encrypt private key: {e}")))?,
        )
    } else {
        None
    };

    // Validate optional DNS overrides up-front so we never persist a half-
    // valid request. We also keep the parsed IPs for the conf below.
    let dns_override_parsed: Option<Vec<std::net::IpAddr>> = match body.dns_override.as_ref() {
        Some(list) if !list.is_empty() => {
            let mut out = Vec::with_capacity(list.len());
            for s in list {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let ip: std::net::IpAddr = trimmed
                    .parse()
                    .map_err(|_| ApiError::Validation(format!("invalid DNS IP: {trimmed}")))?;
                out.push(ip);
            }
            if out.is_empty() { None } else { Some(out) }
        }
        _ => None,
    };

    let split_tunnel = body.split_tunnel.unwrap_or(false);
    let allowed_ips_override_vec: Option<Vec<String>> = if split_tunnel {
        Some(
            SPLIT_TUNNEL_ALLOWED_IPS
                .split(',')
                .map(|s| s.trim().to_string())
                .collect(),
        )
    } else {
        None
    };
    let dns_override_inet: Option<Vec<IpNetwork>> = dns_override_parsed.as_ref().map(|v| {
        v.iter()
            .map(|ip| {
                IpNetwork::new(*ip, if ip.is_ipv4() { 32 } else { 128 })
                    .expect("valid host prefix")
            })
            .collect()
    });

    // Best-effort: persist the device row. If it fails we must release the IP.
    let host_prefix = if ip.is_ipv4() { 32 } else { 128 };
    let allocated_cidr = IpNetwork::new(ip, host_prefix).expect("valid host prefix");
    let device_id = match devices::create(
        &state.pool,
        devices::NewDevice {
            user_id: user.id,
            server_id: server.id,
            name: &body.name,
            os: body.os.unwrap_or(DeviceOs::Other),
            device_type: body.device_type.unwrap_or(DeviceType::Other),
            public_key: &public_key,
            preshared_key_encrypted: None, // will encrypt with KEK in a follow-up
            allocated_ip: allocated_cidr,
            private_key_encrypted: private_key_encrypted.as_deref(),
        },
    )
    .await
    {
        Ok(id) => id,
        Err(e) => {
            // Best-effort release.
            let _ = alloc.release(ip);
            return Err(e.into());
        }
    };

    // Apply per-device overrides chosen at create-time. We do this after
    // insert so the column is a plain UPDATE — keeps `NewDevice` minimal.
    if allowed_ips_override_vec.is_some() || dns_override_inet.is_some() {
        sqlx::query(
            r#"UPDATE devices
                  SET allowed_ips_override = $3,
                      dns_override         = $4
                WHERE user_id = $1 AND id = $2"#,
        )
        .bind(user.id)
        .bind(device_id)
        .bind(allowed_ips_override_vec.as_deref())
        .bind(dns_override_inet.as_deref())
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(format!("apply create overrides: {e}")))?;
    }

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.created",
            target_type: Some("device"),
            target_id: Some(device_id),
            metadata: json!({
                "name": body.name,
                "server": server.name,
                "split_tunnel": split_tunnel,
                "dns_override": body.dns_override,
                "private_key_stored": store_private,
            }),
            ip: None,
        },
    )
    .await?;

    // Render the WG config for the user. The private key is held only here,
    // never persisted.
    let dns_str = match dns_override_parsed.as_ref() {
        Some(ips) => ips
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", "),
        None => server
            .dns_servers_ips()
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", "),
    };
    let endpoint_str = format!("{}:{}", server.endpoint_host, server.endpoint_port);
    let address_str = format!("{}/32", ip);
    let allowed_ips = if split_tunnel {
        SPLIT_TUNNEL_ALLOWED_IPS.to_string()
    } else {
        "0.0.0.0/0, ::/0".to_string()
    };

    let cfg = config::PeerConfig {
        private_key: &private_key,
        address: &address_str,
        dns: &dns_str,
        mtu: Some(server.mtu as u16),
        // Obfuscation disabled: emit a vanilla WireGuard config so the
        // official WireGuard clients accept it and it matches the vanilla
        // server runtime. Re-enable via AmneziaWG (shared, interface-global
        // params written to both client and server) when the AmneziaWG
        // server runtime is wired up.
        amnezia: None,
        server_public_key: &server.public_key,
        preshared_key: None,
        allowed_ips: &allowed_ips,
        endpoint: &endpoint_str,
        keepalive: PERSISTENT_KEEPALIVE,
    };
    let conf_text = cfg
        .render()
        .map_err(|e| ApiError::Internal(format!("render conf: {e}")))?;
    let qr_svg = qr::render_svg(&conf_text)
        .map_err(|e| ApiError::Internal(format!("render qr: {e}")))?;

    let stored = devices::find_for_user(&state.pool, user.id, device_id)
        .await?
        .ok_or_else(|| ApiError::Internal("just-created device missing".into()))?;

    // Hand the new peer to the running WG interface (Noop in dev).
    if let Err(e) = state
        .wg
        .add_peer(&public_key, ip, None, PERSISTENT_KEEPALIVE)
        .await
    {
        tracing::warn!(?e, "wg add_peer failed (continuing — DB row persisted)");
    }

    info!(user_id = %user.id, device_id = %device_id, ip = %ip, "device created");

    Ok((
        axum::http::StatusCode::CREATED,
        Json(CreatedDevice {
            device: stored.into(),
            config: conf_text,
            qr_svg,
        }),
    ))
}

/// Generates a fresh keypair for an existing (non-revoked) device, swaps
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReorderBody {
    pub ids: Vec<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReorderAck {
    #[schema(example = "ok")]
    pub status: &'static str,
    /// Rows actually updated. Ids the caller doesn't own are silently
    /// filtered out by the UPDATE, so `updated < ids.len()` simply means
    /// some ids were unknown.
    pub updated: u64,
}

/// Persist the user's preferred device order. Caller sends the full list
/// of device ids in the new order; we bulk-assign `display_order` so all
/// of the user's sessions see the same arrangement on next /devices
/// fetch. Ignores ids that don't belong to the caller (the UPDATE's
/// `user_id` clause filters them out) so a malicious body can't reorder
/// another user's devices.
#[utoipa::path(
    put,
    path = "/devices/order",
    tag = "Devices",
    request_body = ReorderBody,
    responses(
        (status = 200, description = "Display order persisted", body = ReorderAck),
        (status = 400, description = "Too many ids (>500)"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn reorder(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<ReorderBody>,
) -> ApiResult<impl IntoResponse> {
    if body.ids.is_empty() {
        return Ok(Json(json!({ "status": "ok", "updated": 0 })));
    }
    if body.ids.len() > 500 {
        return Err(ApiError::Validation(
            "too many ids; reorder accepts at most 500".into(),
        ));
    }
    let n = devices::set_display_order(&state.pool, user.id, &body.ids).await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.reordered",
            target_type: Some("device"),
            target_id: None,
            metadata: json!({ "count": body.ids.len() }),
            ip: None,
        },
    )
    .await?;
    info!(user_id = %user.id, count = body.ids.len(), "devices reordered");
    Ok(Json(json!({ "status": "ok", "updated": n })))
}

/// Optional body for rotate-keys. The single field flips the opt-in to
/// server-side private-key storage for the rotated key. Omit / null →
/// inherit the device's current setting; `true` → start storing (or
/// keep storing); `false` → stop storing.
#[derive(Debug, Deserialize, Default, ToSchema)]
pub struct RotateBody {
    #[serde(default)]
    pub store_private_key: Option<bool>,
}

/// the public key on the row, updates the running WG interface, and
/// returns the rendered config + QR so the user can scan the new
/// credentials on their device. Mirrors the `create` response shape so
/// the same dialog UI can render it.
#[utoipa::path(
    post,
    path = "/devices/{id}/rotate-keys",
    tag = "Devices",
    params(
        ("id" = Uuid, Path, description = "Device UUID"),
    ),
    request_body(content = RotateBody, description = "Optional; flips server-side private-key storage", content_type = "application/json"),
    responses(
        (status = 200, description = "New keypair, conf, and QR (shown ONCE)", body = CreatedDevice),
        (status = 404, description = "Not found / not owned"),
        (status = 409, description = "Device is revoked"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn rotate_keys(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
    body: Option<Json<RotateBody>>,
) -> ApiResult<impl IntoResponse> {
    let store_override = body.and_then(|Json(b)| b.store_private_key);
    let device = devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if device.status == DeviceStatus::Revoked {
        return Err(ApiError::Conflict("revoked device cannot rotate keys".into()));
    }

    let server = zerovpn_db::repos::servers::find_by_id(&state.pool, device.server_id)
        .await?
        .ok_or_else(|| ApiError::Internal("device's server missing".into()))?;

    let old_public_key = device.public_key.clone();
    let private_key = keys::generate_private_key();
    let public_key = keys::derive_public_key(&private_key)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let n = devices::update_public_key(&state.pool, user.id, id, &public_key).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }

    // Decide whether the new private key gets stored: explicit flag wins,
    // else inherit the device's current opt-in. Storing means KEK-
    // encrypting and writing; "not storing" means clearing the column so
    // there's no stale ciphertext lying around.
    let should_store = match store_override {
        Some(v) => v,
        None => device.private_key_encrypted.is_some(),
    };
    if should_store {
        let encrypted = state
            .kek
            .encrypt(private_key.as_bytes())
            .map_err(|e| ApiError::Internal(format!("encrypt rotated key: {e}")))?;
        devices::set_private_key_encrypted(&state.pool, user.id, id, Some(&encrypted))
            .await?;
    } else if device.private_key_encrypted.is_some() {
        devices::set_private_key_encrypted(&state.pool, user.id, id, None).await?;
    }

    // Swap the peer on the running WG interface. Best-effort — DB is the
    // source of truth; if WG control is a no-op (dev) the new config will
    // still match what's persisted.
    if let Err(e) = state.wg.remove_peer(&old_public_key).await {
        tracing::warn!(?e, "wg remove_peer (rotate) failed");
    }
    if let Err(e) = state
        .wg
        .add_peer(
            &public_key,
            device.allocated_ip.ip(),
            None,
            PERSISTENT_KEEPALIVE,
        )
        .await
    {
        tracing::warn!(?e, "wg add_peer (rotate) failed");
    }

    // Render the new wg-conf using whatever the device's stored overrides
    // already say. No mock fields — the user gets exactly what their
    // current settings dictate, just with a fresh private key.
    let dns_str = match device.dns_override_ips() {
        Some(ips) if !ips.is_empty() => ips
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", "),
        _ => server
            .dns_servers_ips()
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", "),
    };
    let endpoint_str = format!("{}:{}", server.endpoint_host, server.endpoint_port);
    let address_str = format!("{}/32", device.allocated_ip.ip());
    let allowed_ips = match device.allowed_ips_override.as_ref() {
        Some(list) if !list.is_empty() => list.join(", "),
        _ => "0.0.0.0/0, ::/0".to_string(),
    };
    let cfg = config::PeerConfig {
        private_key: &private_key,
        address: &address_str,
        dns: &dns_str,
        mtu: Some(server.mtu as u16),
        // Obfuscation disabled: emit a vanilla WireGuard config so the
        // official WireGuard clients accept it and it matches the vanilla
        // server runtime. Re-enable via AmneziaWG (shared, interface-global
        // params written to both client and server) when the AmneziaWG
        // server runtime is wired up.
        amnezia: None,
        server_public_key: &server.public_key,
        preshared_key: None,
        allowed_ips: &allowed_ips,
        endpoint: &endpoint_str,
        keepalive: PERSISTENT_KEEPALIVE,
    };
    let conf_text = cfg
        .render()
        .map_err(|e| ApiError::Internal(format!("render conf: {e}")))?;
    let qr_svg = qr::render_svg(&conf_text)
        .map_err(|e| ApiError::Internal(format!("render qr: {e}")))?;

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.keys_rotated",
            target_type: Some("device"),
            target_id: Some(id),
            metadata: json!({ "name": device.name }),
            ip: None,
        },
    )
    .await?;

    let stored = devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or_else(|| ApiError::Internal("rotated device missing".into()))?;

    info!(user_id = %user.id, device_id = %id, "device keys rotated");

    Ok(Json(CreatedDevice {
        device: stored.into(),
        config: conf_text,
        qr_svg,
    }))
}

#[utoipa::path(
    delete,
    path = "/devices/{id}",
    tag = "Devices",
    params(
        ("id" = Uuid, Path, description = "Device UUID"),
    ),
    responses(
        (status = 200, description = "Device revoked + IP released back to the allocator", body = StatusAck),
        (status = 404, description = "Not found / not owned"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let device = devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let n = devices::set_status(&state.pool, user.id, id, DeviceStatus::Revoked).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    if let Some(alloc) = state.allocators.get(device.server_id) {
        let _ = alloc.release(device.allocated_ip.ip());
    }
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.revoked",
            target_type: Some("device"),
            target_id: Some(id),
            metadata: json!({}),
            ip: None,
        },
    )
    .await?;
    if let Err(e) = state.wg.remove_peer(&device.public_key).await {
        tracing::warn!(?e, "wg remove_peer failed (non-fatal)");
    }

    info!(user_id = %user.id, device_id = %id, "device revoked");
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchBody {
    pub name: Option<String>,
    pub os: Option<DeviceOs>,
    pub device_type: Option<DeviceType>,
    pub allowed_ips_override: Option<Vec<String>>,
    pub dns_override: Option<Vec<String>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StoredKeyAck {
    #[schema(example = "ok")]
    pub status: &'static str,
    pub private_key_stored: bool,
}

/// Stop storing the device's encrypted private key on the server. The
/// device keeps working — only the recovery path (re-download .conf
/// without rotating) is removed. To re-enable storage on a device that
/// was previously cleared, rotate keys with `{"store_private_key":true}`.
#[utoipa::path(
    delete,
    path = "/devices/{id}/stored-key",
    tag = "Devices",
    params(
        ("id" = Uuid, Path, description = "Device UUID"),
    ),
    responses(
        (status = 200, description = "Stored key cleared (idempotent)", body = StoredKeyAck),
        (status = 404, description = "Not found / not owned"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn clear_stored_key(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let device = devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if device.private_key_encrypted.is_none() {
        // Already clear — return 200 so the client can be liberal in what
        // it sends. The audit entry is the only visible side-effect.
        return Ok(Json(json!({ "status": "ok", "private_key_stored": false })));
    }
    devices::set_private_key_encrypted(&state.pool, user.id, id, None).await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.stored_key_cleared",
            target_type: Some("device"),
            target_id: Some(id),
            metadata: json!({ "name": device.name }),
            ip: None,
        },
    )
    .await?;
    info!(user_id = %user.id, device_id = %id, "stored key cleared");
    Ok(Json(json!({ "status": "ok", "private_key_stored": false })))
}

/// Re-render the device's .conf from the server-stored private key.
/// Returns 404 if the device doesn't exist, 409 if the device was
/// created without `store_private_key` (no key to recover). Owner-only;
/// audit-logged so a stolen session leaves a paper trail.
#[utoipa::path(
    get,
    path = "/devices/{id}/conf",
    tag = "Devices",
    params(
        ("id" = Uuid, Path, description = "Device UUID"),
    ),
    responses(
        (status = 200, description = "Re-rendered .conf + QR using current overrides", body = CreatedDevice),
        (status = 404, description = "Not found / not owned"),
        (status = 409, description = "Device is revoked, or was not created with stored private key"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn redownload_conf(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let device = devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if device.status == DeviceStatus::Revoked {
        return Err(ApiError::Conflict("device is revoked".into()));
    }
    let encrypted = device
        .private_key_encrypted
        .as_ref()
        .ok_or_else(|| {
            ApiError::Conflict(
                "device was not created with server-side key storage; rotate keys to re-issue"
                    .into(),
            )
        })?;
    let private_bytes = state
        .kek
        .decrypt(encrypted)
        .map_err(|e| ApiError::Internal(format!("decrypt private key: {e}")))?;
    let private_key = String::from_utf8(private_bytes)
        .map_err(|_| ApiError::Internal("stored private key is not UTF-8".into()))?;

    let server = zerovpn_db::repos::servers::find_by_id(&state.pool, device.server_id)
        .await?
        .ok_or_else(|| ApiError::Internal("device's server missing".into()))?;

    // Same conf-render path as `create` + `rotate_keys`. Pulls overrides
    // from the device row so the re-download reflects the user's current
    // configuration, not the one captured at create time.
    let dns_str = match device.dns_override_ips() {
        Some(ips) if !ips.is_empty() => ips
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", "),
        _ => server
            .dns_servers_ips()
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", "),
    };
    let endpoint_str = format!("{}:{}", server.endpoint_host, server.endpoint_port);
    let address_str = format!("{}/32", device.allocated_ip.ip());
    let allowed_ips = match device.allowed_ips_override.as_ref() {
        Some(list) if !list.is_empty() => list.join(", "),
        _ => "0.0.0.0/0, ::/0".to_string(),
    };
    let cfg = config::PeerConfig {
        private_key: &private_key,
        address: &address_str,
        dns: &dns_str,
        mtu: Some(server.mtu as u16),
        // Obfuscation disabled: emit a vanilla WireGuard config so the
        // official WireGuard clients accept it and it matches the vanilla
        // server runtime. Re-enable via AmneziaWG (shared, interface-global
        // params written to both client and server) when the AmneziaWG
        // server runtime is wired up.
        amnezia: None,
        server_public_key: &server.public_key,
        preshared_key: None,
        allowed_ips: &allowed_ips,
        endpoint: &endpoint_str,
        keepalive: PERSISTENT_KEEPALIVE,
    };
    let conf_text = cfg
        .render()
        .map_err(|e| ApiError::Internal(format!("render conf: {e}")))?;
    let qr_svg = qr::render_svg(&conf_text)
        .map_err(|e| ApiError::Internal(format!("render qr: {e}")))?;

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.conf_redownloaded",
            target_type: Some("device"),
            target_id: Some(id),
            metadata: json!({ "name": device.name }),
            ip: None,
        },
    )
    .await?;

    Ok(Json(CreatedDevice {
        device: device.into(),
        config: conf_text,
        qr_svg,
    }))
}

#[utoipa::path(
    patch,
    path = "/devices/{id}",
    tag = "Devices",
    params(
        ("id" = Uuid, Path, description = "Device UUID"),
    ),
    request_body = PatchBody,
    responses(
        (status = 200, description = "Device updated", body = StatusAck),
        (status = 400, description = "Validation error (bad CIDR / IP)"),
        (status = 404, description = "Not found / not owned"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn patch(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchBody>,
) -> ApiResult<impl IntoResponse> {
    devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if let Some(ref name) = body.name {
        if name.trim().is_empty() || name.len() > 64 {
            return Err(ApiError::Validation("name must be 1–64 chars".into()));
        }
    }
    if let Some(ref ips) = body.allowed_ips_override {
        for s in ips {
            if s.parse::<IpNetwork>().is_err() && s.parse::<std::net::IpAddr>().is_err() {
                return Err(ApiError::Validation(format!("invalid CIDR: {s}")));
            }
        }
    }
    let dns_override_inet: Option<Vec<IpNetwork>> = if let Some(ref dns) = body.dns_override {
        let mut out = Vec::with_capacity(dns.len());
        for s in dns {
            let ip: std::net::IpAddr = s
                .parse()
                .map_err(|_| ApiError::Validation(format!("invalid IP: {s}")))?;
            out.push(
                IpNetwork::new(ip, if ip.is_ipv4() { 32 } else { 128 })
                    .expect("valid host prefix"),
            );
        }
        Some(out)
    } else {
        None
    };

    sqlx::query(
        r#"UPDATE devices
              SET name = COALESCE($3, name),
                  os = COALESCE($4, os),
                  device_type = COALESCE($7, device_type),
                  allowed_ips_override = $5,
                  dns_override = $6
            WHERE user_id = $1 AND id = $2"#,
    )
    .bind(user.id)
    .bind(id)
    .bind(body.name.as_deref())
    .bind(body.os)
    .bind(body.allowed_ips_override.as_deref())
    .bind(dns_override_inet.as_deref())
    .bind(body.device_type)
    .execute(&state.pool)
    .await?;

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.updated",
            target_type: Some("device"),
            target_id: Some(id),
            metadata: json!({
                "name_changed": body.name.is_some(),
                "os_changed": body.os.is_some(),
                "split_tunnel_changed": body.allowed_ips_override.is_some(),
                "dns_changed": body.dns_override.is_some(),
            }),
            ip: None,
        },
    )
    .await?;
    info!(user_id = %user.id, device_id = %id, "device patched");
    Ok(Json(json!({ "status": "ok" })))
}

#[utoipa::path(
    post,
    path = "/devices/{id}/pause",
    tag = "Devices",
    params(
        ("id" = Uuid, Path, description = "Device UUID"),
    ),
    responses(
        (status = 200, description = "Device paused; peer removed from running WG", body = StatusAck),
        (status = 404, description = "Not found / not owned"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn pause(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    set_pause_state(&state, user.id, id, DeviceStatus::Paused).await?;
    Ok(Json(json!({ "status": "paused" })))
}

#[utoipa::path(
    post,
    path = "/devices/{id}/unpause",
    tag = "Devices",
    params(
        ("id" = Uuid, Path, description = "Device UUID"),
    ),
    responses(
        (status = 200, description = "Device resumed; peer re-added to running WG", body = StatusAck),
        (status = 404, description = "Not found / not owned"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn unpause(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    set_pause_state(&state, user.id, id, DeviceStatus::Active).await?;
    Ok(Json(json!({ "status": "active" })))
}

async fn set_pause_state(
    state: &AppState,
    user_id: Uuid,
    device_id: Uuid,
    target: DeviceStatus,
) -> ApiResult<()> {
    let device = devices::find_for_user(&state.pool, user_id, device_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if device.status == DeviceStatus::Revoked {
        return Err(ApiError::Conflict("revoked device cannot change status".into()));
    }
    let n = devices::set_status(&state.pool, user_id, device_id, target).await?;
    if n == 0 {
        return Err(ApiError::NotFound);
    }

    // Reflect status to the running WG interface.
    match target {
        DeviceStatus::Paused => {
            if let Err(e) = state.wg.remove_peer(&device.public_key).await {
                tracing::warn!(?e, "wg remove_peer (pause) failed");
            }
        }
        DeviceStatus::Active => {
            if let Err(e) = state
                .wg
                .add_peer(
                    &device.public_key,
                    device.allocated_ip.ip(),
                    None,
                    PERSISTENT_KEEPALIVE,
                )
                .await
            {
                tracing::warn!(?e, "wg add_peer (unpause) failed");
            }
        }
        _ => {}
    }

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user_id),
            action: match target {
                DeviceStatus::Paused => "device.paused",
                DeviceStatus::Active => "device.unpaused",
                _ => "device.status_changed",
            },
            target_type: Some("device"),
            target_id: Some(device_id),
            metadata: json!({ "to": target }),
            ip: None,
        },
    )
    .await?;

    Ok(())
}

fn allocate_auto(alloc: &Arc<IpAllocator>) -> ApiResult<IpAddr> {
    alloc
        .allocate()
        .map_err(|_| ApiError::Conflict("server IP pool exhausted".into()))
}

/// Caller-supplied IP path. Parses the string and asks the allocator
/// to atomically claim it inside the server's CIDR. Family must match
/// the server's CIDR; mismatches surface as a validation error so the
/// frontend can render a clear message. Maps the other interesting
/// outcomes to specific API errors so toasts can be targeted
/// ("already taken" vs "outside subnet" vs "reserved address").
fn reserve_specific(
    alloc: &Arc<IpAllocator>,
    raw: &str,
) -> ApiResult<IpAddr> {
    use zerovpn_wg::ip_alloc::AllocError;
    let parsed: std::net::IpAddr = raw
        .trim()
        .parse()
        .map_err(|_| ApiError::Validation(format!("invalid IP: {raw}")))?;
    match alloc.try_reserve(parsed) {
        Ok(()) => Ok(parsed),
        Err(AllocError::AlreadyAllocated) => Err(ApiError::Conflict(format!(
            "{parsed} is already assigned to another device"
        ))),
        Err(AllocError::OutOfRange) => Err(ApiError::Validation(format!(
            "{parsed} is outside the server's subnet"
        ))),
        Err(AllocError::Reserved) => Err(ApiError::Validation(format!(
            "{parsed} is a reserved address (network / broadcast / gateway)"
        ))),
        Err(AllocError::Exhausted) => {
            Err(ApiError::Conflict("server IP pool exhausted".into()))
        }
        Err(AllocError::FamilyMismatch(want, got)) => Err(ApiError::Validation(format!(
            "IP family mismatch: server expects {want}, got {got}"
        ))),
    }
}

