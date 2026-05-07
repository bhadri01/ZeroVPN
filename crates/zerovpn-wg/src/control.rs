//! WG runtime controller.
//!
//! v1 ships two implementations:
//!
//! - `NoopController` — accepts every call silently. Used in dev when
//!   there's no WG interface to drive (e.g., on Docker Desktop without
//!   the kernel module loaded).
//! - `ShellController` — shells out to the `wg` binary inside the wg
//!   container's network namespace via `nsenter`. Used in prod where
//!   a real WG interface exists. Requires `wg` and `nsenter` in the
//!   worker's image and a shared netns mount.
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

/// Production backend that shells out to `wg set <iface> peer ...`.
/// Configured by the `WG_INTERFACE` env var (defaults to `wg0`).
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
        let mut args: Vec<String> = vec![
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
        // and instead use the AmneziaWG params. Keeping the parameter
        // shape so the trait signature is stable.
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

/// Build the configured controller based on the env var
/// `ZEROVPN_WG__BACKEND` ∈ { noop | shell }, defaulting to `noop`.
pub fn from_env() -> std::sync::Arc<dyn WgController> {
    match std::env::var("ZEROVPN_WG__BACKEND")
        .unwrap_or_else(|_| "noop".into())
        .as_str()
    {
        "shell" => {
            info!("using ShellController for WG runtime");
            std::sync::Arc::new(ShellController::from_env())
        }
        _ => {
            info!("using NoopController for WG runtime (set ZEROVPN_WG__BACKEND=shell to enable)");
            std::sync::Arc::new(NoopController)
        }
    }
}
