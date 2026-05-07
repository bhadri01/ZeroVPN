//! Prometheus `/metrics` endpoint.
//!
//! Wires the global recorder set up in `main.rs::init_metrics` and serves
//! the Prometheus text exposition format at `GET /metrics`.

use axum::{
    extract::State,
    http::{StatusCode, header},
    response::IntoResponse,
};
use metrics_exporter_prometheus::PrometheusHandle;

use crate::state::AppState;

/// `GET /metrics` — Prometheus text format. Unauthenticated by design;
/// scrape protection (firewall / Caddy basic-auth) lives at the proxy
/// layer in production.
pub async fn metrics(State(_state): State<AppState>) -> impl IntoResponse {
    match PROM_HANDLE.get() {
        Some(h) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
            h.render(),
        )
            .into_response(),
        None => (StatusCode::SERVICE_UNAVAILABLE, "metrics not initialized").into_response(),
    }
}

use std::sync::OnceLock;
static PROM_HANDLE: OnceLock<PrometheusHandle> = OnceLock::new();

pub fn install_global_recorder() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let builder = metrics_exporter_prometheus::PrometheusBuilder::new();
    let handle = builder.install_recorder()?;
    PROM_HANDLE
        .set(handle)
        .map_err(|_| "prometheus recorder already installed")?;

    // Pre-register a few baseline metrics so `/metrics` isn't empty.
    metrics::describe_counter!(
        "zerovpn_api_requests_total",
        "Total HTTP requests handled (placeholder; granular labels via tracing → metrics middleware later)"
    );
    metrics::describe_counter!(
        "zerovpn_ws_clients_connected",
        "WebSocket connection upgrades handled"
    );
    metrics::describe_counter!(
        "zerovpn_devices_created",
        "Devices created since process start"
    );
    metrics::describe_counter!(
        "zerovpn_devices_revoked",
        "Devices revoked since process start"
    );
    Ok(())
}
