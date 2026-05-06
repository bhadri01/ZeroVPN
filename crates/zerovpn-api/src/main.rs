use std::{env, net::SocketAddr, sync::Arc};

use anyhow::{Context, Result};
use axum::{
    Router,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use sqlx::Row;
use tokio::signal;
use tower_http::{
    compression::CompressionLayer, cors::CorsLayer, request_id::SetRequestIdLayer,
    trace::TraceLayer,
};
use tracing::{error, info, warn};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

mod state;

use state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    init_tracing();
    info!(version = env!("CARGO_PKG_VERSION"), "zerovpn-api starting");

    let bind_addr = env::var("ZEROVPN_BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let database_url = env::var("ZEROVPN_DATABASE_URL")
        .context("ZEROVPN_DATABASE_URL is required")?;

    let pool = zerovpn_db::init_pool(&database_url, 16)
        .await
        .context("connect db")?;
    info!("db connected");

    let app_state = Arc::new(AppState { pool });

    let app = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/api/v1/ping", get(ping))
        .with_state(app_state)
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
        .layer(SetRequestIdLayer::x_request_id(
            tower_http::request_id::MakeRequestUuid,
        ))
        .layer(TraceLayer::new_for_http());

    let addr: SocketAddr = bind_addr.parse().context("parse bind address")?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, "listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("axum serve")?;

    info!("zerovpn-api stopped");
    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_env("RUST_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info,zerovpn=debug"));
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().json())
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(e) = signal::ctrl_c().await {
            error!(?e, "ctrl_c handler");
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(mut sigterm) => {
                sigterm.recv().await;
            }
            Err(e) => {
                warn!(?e, "sigterm handler");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => info!("ctrl-c received"),
        _ = terminate => info!("sigterm received"),
    }
}

#[derive(serde::Serialize)]
struct Health {
    status: &'static str,
    version: &'static str,
}

async fn health() -> impl IntoResponse {
    axum::Json(Health { status: "ok", version: env!("CARGO_PKG_VERSION") })
}

async fn ready(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").fetch_one(&state.pool).await {
        Ok(row) => {
            let _: i32 = row.get(0);
            (StatusCode::OK, axum::Json(serde_json::json!({ "ready": true }))).into_response()
        }
        Err(e) => {
            error!(?e, "db not ready");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                axum::Json(serde_json::json!({ "ready": false, "reason": "db" })),
            )
                .into_response()
        }
    }
}

async fn ping() -> impl IntoResponse {
    axum::Json(serde_json::json!({ "pong": true, "ts_ms": time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000 }))
}
