use std::{net::IpAddr, sync::Arc};

use askama::Template;
use axum::{
    Json,
    extract::{Path, State},
    response::IntoResponse,
};
use garde::Validate;
use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tracing::info;
use uuid::Uuid;
use zerovpn_core::models::{Device, DeviceOs, DeviceStatus};
use zerovpn_db::repos::{audit, devices, servers};
use zerovpn_obfs::AmneziaParams;
use zerovpn_wg::{config, ip_alloc::IpAllocator, keys, qr};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::CurrentUser,
    state::AppState,
};

const MAX_DEVICES_PER_USER: usize = 5;
const PERSISTENT_KEEPALIVE: u16 = 25;

#[derive(Debug, Deserialize, Validate)]
pub struct CreateBody {
    #[garde(length(min = 1, max = 64))]
    pub name: String,
    #[garde(skip)]
    pub os: Option<DeviceOs>,
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
}

#[derive(Debug, Serialize)]
pub struct CreatedDevice {
    pub device: PublicDevice,
    pub config: String,
    pub qr_svg: String,
}

#[derive(Debug, Serialize)]
pub struct PublicDevice {
    pub id: Uuid,
    pub name: String,
    pub os: DeviceOs,
    pub public_key: String,
    pub allocated_ip: IpAddr,
    pub status: DeviceStatus,
    pub server_id: Uuid,
    pub dns_names: Vec<String>,
    pub allowed_ips_override: Option<Vec<String>>,
    pub dns_override: Option<Vec<String>>,
    pub last_handshake_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

impl From<Device> for PublicDevice {
    fn from(d: Device) -> Self {
        let dns_override = d
            .dns_override
            .as_ref()
            .map(|v| v.iter().map(|n| n.ip().to_string()).collect());
        Self {
            id: d.id,
            name: d.name,
            os: d.os,
            public_key: d.public_key,
            allocated_ip: d.allocated_ip.ip(),
            status: d.status,
            server_id: d.server_id,
            dns_names: d.dns_names,
            allowed_ips_override: d.allowed_ips_override,
            dns_override,
            last_handshake_at: d.last_handshake_at,
            created_at: d.created_at,
        }
    }
}

/// RFC1918 + IPv6 ULA — used when `split_tunnel = true` so only private
/// subnets route through the tunnel.
const SPLIT_TUNNEL_ALLOWED_IPS: &str =
    "10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fd00::/8";

pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    let rows = devices::list_for_user(&state.pool, user.id).await?;
    let out: Vec<PublicDevice> = rows.into_iter().map(Into::into).collect();
    Ok(Json(out))
}

pub async fn get(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let d = devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(PublicDevice::from(d)))
}

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
        None => allocate_v4(&alloc)?,
    };

    let private_key = keys::generate_private_key();
    let public_key = keys::derive_public_key(&private_key)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let amnezia = AmneziaParams::random();

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
    let allocated_cidr = IpNetwork::new(ip, 32).expect("valid /32");
    let device_id = match devices::create(
        &state.pool,
        devices::NewDevice {
            user_id: user.id,
            server_id: server.id,
            name: &body.name,
            os: body.os.unwrap_or(DeviceOs::Other),
            public_key: &public_key,
            preshared_key_encrypted: None, // will encrypt with KEK in a follow-up
            allocated_ip: allocated_cidr,
        },
    )
    .await
    {
        Ok(id) => id,
        Err(e) => {
            // Best-effort release.
            if let std::net::IpAddr::V4(v4) = ip {
                let _ = alloc.release(v4);
            }
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
            }),
            ip_prefix: None,
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
        amnezia: Some(config::AmneziaParams {
            jc: amnezia.jc,
            jmin: amnezia.jmin,
            jmax: amnezia.jmax,
            s1: amnezia.s1,
            s2: amnezia.s2,
            h1: amnezia.h1,
            h2: amnezia.h2,
            h3: amnezia.h3,
            h4: amnezia.h4,
        }),
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
    if let std::net::IpAddr::V4(v4) = device.allocated_ip.ip() {
        if let Some(alloc) = state.allocators.get(device.server_id) {
            let _ = alloc.release(v4);
        }
    }
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.revoked",
            target_type: Some("device"),
            target_id: Some(id),
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    if let Err(e) = state.wg.remove_peer(&device.public_key).await {
        tracing::warn!(?e, "wg remove_peer failed (non-fatal)");
    }

    zerovpn_db::webhook_dispatch::dispatch(
        &state.pool,
        zerovpn_db::repos::webhooks::WebhookEventKind::DeviceRevoked,
        json!({ "device_id": id, "user_id": user.id, "device_name": device.name }),
    )
    .await;

    info!(user_id = %user.id, device_id = %id, "device revoked");
    Ok(Json(json!({ "status": "ok" })))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub name: Option<String>,
    pub allowed_ips_override: Option<Vec<String>>,
    pub dns_override: Option<Vec<String>>,
}

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
                  allowed_ips_override = $4,
                  dns_override = $5
            WHERE user_id = $1 AND id = $2"#,
    )
    .bind(user.id)
    .bind(id)
    .bind(body.name.as_deref())
    .bind(body.allowed_ips_override.as_deref())
    .bind(dns_override_inet.as_deref())
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
                "split_tunnel_changed": body.allowed_ips_override.is_some(),
                "dns_changed": body.dns_override.is_some(),
            }),
            ip_prefix: None,
        },
    )
    .await?;
    info!(user_id = %user.id, device_id = %id, "device patched");
    Ok(Json(json!({ "status": "ok" })))
}

pub async fn pause(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    set_pause_state(&state, user.id, id, DeviceStatus::Paused).await?;
    Ok(Json(json!({ "status": "paused" })))
}

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
            ip_prefix: None,
        },
    )
    .await?;

    if target == DeviceStatus::Paused {
        zerovpn_db::webhook_dispatch::dispatch(
            &state.pool,
            zerovpn_db::repos::webhooks::WebhookEventKind::DevicePaused,
            json!({ "device_id": device_id, "user_id": user_id }),
        )
        .await;
    }
    Ok(())
}

fn allocate_v4(alloc: &Arc<IpAllocator>) -> ApiResult<IpAddr> {
    match alloc.allocate() {
        Ok(v4) => Ok(IpAddr::V4(v4)),
        Err(_) => Err(ApiError::Conflict("server IP pool exhausted".into())),
    }
}

/// Caller-supplied IP path. Parses the string, ensures it's IPv4, then
/// asks the allocator to atomically claim it inside the server's CIDR.
/// Maps the four interesting outcomes to specific API errors so the
/// frontend can render targeted toasts ("already taken" vs "outside
/// subnet" vs "reserved address").
fn reserve_specific(
    alloc: &Arc<IpAllocator>,
    raw: &str,
) -> ApiResult<IpAddr> {
    use zerovpn_wg::ip_alloc::AllocError;
    let parsed: std::net::IpAddr = raw
        .trim()
        .parse()
        .map_err(|_| ApiError::Validation(format!("invalid IP: {raw}")))?;
    let v4 = match parsed {
        std::net::IpAddr::V4(v4) => v4,
        std::net::IpAddr::V6(_) => {
            return Err(ApiError::Validation(
                "only IPv4 addresses are supported for manual allocation".into(),
            ));
        }
    };
    match alloc.try_reserve(v4) {
        Ok(()) => Ok(IpAddr::V4(v4)),
        Err(AllocError::AlreadyAllocated) => Err(ApiError::Conflict(format!(
            "{v4} is already assigned to another device"
        ))),
        Err(AllocError::OutOfRange) => Err(ApiError::Validation(format!(
            "{v4} is outside the server's subnet"
        ))),
        Err(AllocError::Reserved) => Err(ApiError::Validation(format!(
            "{v4} is a reserved address (network / broadcast / gateway)"
        ))),
        Err(AllocError::Exhausted) => {
            Err(ApiError::Conflict("server IP pool exhausted".into()))
        }
    }
}

