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
    pub dns_names: Vec<String>,
    pub allowed_ips_override: Option<Vec<String>>,
    pub last_handshake_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

impl From<Device> for PublicDevice {
    fn from(d: Device) -> Self {
        Self {
            id: d.id,
            name: d.name,
            os: d.os,
            public_key: d.public_key,
            allocated_ip: d.allocated_ip.ip(),
            status: d.status,
            dns_names: d.dns_names,
            allowed_ips_override: d.allowed_ips_override,
            last_handshake_at: d.last_handshake_at,
            created_at: d.created_at,
        }
    }
}

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
    let ip = allocate_v4(&alloc)?;

    let private_key = keys::generate_private_key();
    let public_key = keys::derive_public_key(&private_key)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let amnezia = AmneziaParams::random();

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

    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(user.id),
            action: "device.created",
            target_type: Some("device"),
            target_id: Some(device_id),
            metadata: json!({ "name": body.name, "server": server.name }),
            ip_prefix: None,
        },
    )
    .await?;

    // Render the WG config for the user. The private key is held only here,
    // never persisted.
    let dns_str = server
        .dns_servers_ips()
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let endpoint_str = format!("{}:{}", server.endpoint_host, server.endpoint_port);
    let address_str = format!("{}/32", ip);
    let allowed_ips = "0.0.0.0/0, ::/0".to_string();

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
    info!(user_id = %user.id, device_id = %id, "device revoked");
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
    Ok(())
}

fn allocate_v4(alloc: &Arc<IpAllocator>) -> ApiResult<IpAddr> {
    match alloc.allocate() {
        Ok(v4) => Ok(IpAddr::V4(v4)),
        Err(_) => Err(ApiError::Conflict("server IP pool exhausted".into())),
    }
}

