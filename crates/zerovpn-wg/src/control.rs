//! WG runtime controller.
//!
//! v1 ships three implementations selected by the `ZEROVPN_WG__BACKEND`
//! env var:
//!
//! - `noop` (default) — accepts every call silently. Used in dev when
//!   there's no WG interface to drive (e.g., on Docker Desktop without
//!   the kernel module loaded).
//! - `kernel` — talks to the in-kernel WireGuard module directly via
//!   netlink, using `defguard_wireguard_rs`. Preferred for production:
//!   no `wg` binary in the worker image, no `nsenter` shell hop, native
//!   Rust errors instead of stderr parsing. Linux-only; falls back to
//!   `noop` with a warning on non-Linux hosts.
//! - `shell` — legacy backend that shells out to `wg set <iface> peer …`.
//!   Kept for environments where netlink isn't reachable (e.g. the api
//!   container running outside the WG netns and using `nsenter` in its
//!   own wrapper). Will be retired once the kernel backend is rolled
//!   out everywhere.
//!
//! The controller is invoked from the API on device create/revoke/pause/
//! unpause AND from the worker's reconciler (1B-E follow-up) which
//! periodically reconciles WG state with the DB.

use async_trait::async_trait;
use std::net::IpAddr;
use thiserror::Error;
use tracing::{info, warn};

#[derive(Debug, Error)]
pub enum ControlError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("wg command failed: {0}")]
    WgCommand(String),
    #[error("wg control: {0}")]
    Other(String),
}

#[async_trait]
pub trait WgController: Send + Sync {
    /// Add a peer to the running WG interface.
    async fn add_peer(
        &self,
        public_key: &str,
        allocated_ip: IpAddr,
        preshared_key: Option<&str>,
        keepalive_seconds: u16,
    ) -> Result<(), ControlError>;

    /// Remove a peer from the running WG interface (idempotent).
    async fn remove_peer(&self, public_key: &str) -> Result<(), ControlError>;
}

/// Default backend in dev / on macOS Docker Desktop without kernel WG.
/// Logs every call and returns Ok.
pub struct NoopController;

#[async_trait]
impl WgController for NoopController {
    async fn add_peer(
        &self,
        public_key: &str,
        allocated_ip: IpAddr,
        _preshared_key: Option<&str>,
        keepalive_seconds: u16,
    ) -> Result<(), ControlError> {
        info!(
            backend = "noop",
            %public_key,
            %allocated_ip,
            keepalive_seconds,
            "wg add_peer (noop — no live WG interface)"
        );
        Ok(())
    }
    async fn remove_peer(&self, public_key: &str) -> Result<(), ControlError> {
        info!(backend = "noop", %public_key, "wg remove_peer (noop)");
        Ok(())
    }
}

/// Legacy backend that shells out to `wg set <iface> peer ...`.
/// Configured by the `ZEROVPN_WG__INTERFACE` env var (defaults to `wg0`).
///
/// Retained for environments that can't reach the WG netlink socket
/// (e.g. when the api/worker is wrapped by `nsenter` instead of running
/// in the WG netns). Prefer the kernel backend.
pub struct ShellController {
    pub interface: String,
}

impl ShellController {
    pub fn from_env() -> Self {
        Self {
            interface: std::env::var("ZEROVPN_WG__INTERFACE").unwrap_or_else(|_| "wg0".into()),
        }
    }
}

#[async_trait]
impl WgController for ShellController {
    async fn add_peer(
        &self,
        public_key: &str,
        allocated_ip: IpAddr,
        preshared_key: Option<&str>,
        keepalive_seconds: u16,
    ) -> Result<(), ControlError> {
        let allowed = format!("{}/32", allocated_ip);
        let args: Vec<String> = vec![
            "set".to_string(),
            self.interface.clone(),
            "peer".to_string(),
            public_key.to_string(),
            "persistent-keepalive".to_string(),
            keepalive_seconds.to_string(),
            "allowed-ips".to_string(),
            allowed,
        ];
        // PSK is passed via stdin per `wg set` semantics — for v1 we omit
        // it. Keeping the parameter shape so the trait signature is stable.
        let _ = preshared_key;
        let out = tokio::process::Command::new("wg")
            .args(args.iter().map(String::as_str))
            .output()
            .await?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            warn!(?args, stderr, "wg set failed");
            return Err(ControlError::WgCommand(stderr));
        }
        Ok(())
    }

    async fn remove_peer(&self, public_key: &str) -> Result<(), ControlError> {
        let out = tokio::process::Command::new("wg")
            .args([
                "set",
                &self.interface,
                "peer",
                public_key,
                "remove",
            ])
            .output()
            .await?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            // `peer remove` of a non-existent peer is OK — we treat any
            // failure as logged but non-fatal so revoke calls stay
            // idempotent.
            warn!(stderr, "wg set peer remove failed (non-fatal)");
        }
        Ok(())
    }
}

/// Native backend that talks to the in-kernel WireGuard module via
/// netlink using `defguard_wireguard_rs`. Avoids forking `wg` and
/// produces structured errors instead of stderr strings.
///
/// Linux-only — `defguard_wireguard_rs::Kernel` has no
/// implementation on other targets. The constructor returns an error
/// on non-Linux so `from_env()` can fall back to noop.
#[cfg(target_os = "linux")]
pub struct KernelController {
    interface: String,
}

#[cfg(target_os = "linux")]
impl KernelController {
    pub fn from_env() -> Self {
        Self {
            interface: std::env::var("ZEROVPN_WG__INTERFACE").unwrap_or_else(|_| "wg0".into()),
        }
    }
}

#[cfg(target_os = "linux")]
#[async_trait]
impl WgController for KernelController {
    async fn add_peer(
        &self,
        public_key: &str,
        allocated_ip: IpAddr,
        preshared_key: Option<&str>,
        keepalive_seconds: u16,
    ) -> Result<(), ControlError> {
        let interface = self.interface.clone();
        let public_key = public_key.to_string();
        let preshared_key = preshared_key.map(|s| s.to_string());
        tokio::task::spawn_blocking(move || -> Result<(), ControlError> {
            use defguard_wireguard_rs::{
                Kernel, WGApi, WireguardInterfaceApi, key::Key as DgKey, net::IpAddrMask,
                peer::Peer as DgPeer,
            };
            let api = WGApi::<Kernel>::new(interface.clone())
                .map_err(|e| ControlError::Other(e.to_string()))?;
            let pubkey = DgKey::try_from(public_key.as_str()).map_err(|e| {
                ControlError::Other(format!("invalid peer public_key: {e}"))
            })?;
            let mut peer = DgPeer::new(pubkey);
            if let Some(psk) = preshared_key {
                let psk_key = DgKey::try_from(psk.as_str()).map_err(|e| {
                    ControlError::Other(format!("invalid preshared_key: {e}"))
                })?;
                peer.preshared_key = Some(psk_key);
            }
            peer.persistent_keepalive_interval = Some(keepalive_seconds);
            peer.allowed_ips = vec![IpAddrMask::host(allocated_ip)];
            api.configure_peer(&peer)
                .map_err(|e| ControlError::WgCommand(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| ControlError::Other(format!("blocking task join: {e}")))??;
        Ok(())
    }

    async fn remove_peer(&self, public_key: &str) -> Result<(), ControlError> {
        let interface = self.interface.clone();
        let public_key = public_key.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), ControlError> {
            use defguard_wireguard_rs::{
                Kernel, WGApi, WireguardInterfaceApi, key::Key as DgKey,
            };
            let api = WGApi::<Kernel>::new(interface.clone())
                .map_err(|e| ControlError::Other(e.to_string()))?;
            let pubkey = DgKey::try_from(public_key.as_str()).map_err(|e| {
                ControlError::Other(format!("invalid peer public_key: {e}"))
            })?;
            if let Err(e) = api.remove_peer(&pubkey) {
                // Idempotent: missing peer is a normal revoke retry.
                warn!(error = %e, %public_key, "kernel remove_peer (non-fatal)");
            }
            Ok(())
        })
        .await
        .map_err(|e| ControlError::Other(format!("blocking task join: {e}")))??;
        Ok(())
    }
}

/// Build the configured controller based on the env var
/// `ZEROVPN_WG__BACKEND` ∈ { noop | kernel | shell }, defaulting to
/// `noop`. `kernel` is the preferred prod backend; on non-Linux hosts
/// it logs a warning and falls back to noop so dev on macOS still
/// boots.
pub fn from_env() -> std::sync::Arc<dyn WgController> {
    let backend = std::env::var("ZEROVPN_WG__BACKEND").unwrap_or_else(|_| "noop".into());
    match backend.as_str() {
        "kernel" => {
            #[cfg(target_os = "linux")]
            {
                info!("using KernelController for WG runtime (defguard netlink UAPI)");
                std::sync::Arc::new(KernelController::from_env())
            }
            #[cfg(not(target_os = "linux"))]
            {
                warn!(
                    "ZEROVPN_WG__BACKEND=kernel requested on non-Linux host; \
                     defguard_wireguard_rs Kernel API is Linux-only. \
                     Falling back to NoopController."
                );
                std::sync::Arc::new(NoopController)
            }
        }
        "shell" => {
            info!("using ShellController for WG runtime (legacy `wg` binary)");
            std::sync::Arc::new(ShellController::from_env())
        }
        _ => {
            info!(
                "using NoopController for WG runtime \
                 (set ZEROVPN_WG__BACKEND=kernel to enable native netlink)"
            );
            std::sync::Arc::new(NoopController)
        }
    }
}
