use std::{env, net::SocketAddr, time::Duration};

use anyhow::{Context, Result};
use axum::{
    Router,
    routing::{get, post},
};
use tokio::signal;
use tower_http::{
    compression::CompressionLayer, cors::CorsLayer, request_id::SetRequestIdLayer,
    trace::TraceLayer,
};
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::PostgresStore;
use tracing::{debug, error, info, warn};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};
use zerovpn_events::Subscriber;
use zerovpn_wire::Event;

mod bootstrap;
mod error;
mod extractors;
mod routes;
mod state;

use state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    init_tracing();
    info!(version = env!("CARGO_PKG_VERSION"), "zerovpn-api starting");

    let bind_addr =
        env::var("ZEROVPN_BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let database_url =
        env::var("ZEROVPN_DATABASE_URL").context("ZEROVPN_DATABASE_URL is required")?;

    let pool = zerovpn_db::init_pool(&database_url, 16)
        .await
        .context("connect db")?;
    info!("db connected");

    // Run app migrations on startup. Idempotent.
    zerovpn_db::run_migrations(&pool)
        .await
        .context("run migrations")?;

    // Tower-sessions session store + its own migration.
    let session_store = PostgresStore::new(pool.clone());
    session_store.migrate().await.context("session store migrate")?;
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(false) // dev only; flip in prod
        .with_http_only(true)
        .with_same_site(tower_sessions::cookie::SameSite::Lax)
        .with_name("zerovpn_session")
        .with_expiry(Expiry::OnInactivity(time::Duration::minutes(30)));

    bootstrap::ensure_default_server(&pool)
        .await
        .context("bootstrap server")?;
    let allocators = bootstrap::build_ip_allocators(&pool)
        .await
        .context("build ip allocators")?;

    let kek_b64 = env::var("ZEROVPN_KEK").context("ZEROVPN_KEK is required")?;
    let kek = zerovpn_auth::kek::Kek::from_b64(&kek_b64)
        .map_err(|e| anyhow::anyhow!("invalid KEK: {e}"))?;

    let app_state = AppState::new(pool, allocators, kek);

    // ZMQ subscriber: consumes worker events (subscribed to all topics) and
    // forwards them onto the in-process broadcast bus that WS handlers tap.
    if let Ok(sub_url) = env::var("ZEROVPN_EVENTS__SUBSCRIBER_CONNECT") {
        let bus = app_state.events.clone();
        tokio::spawn(async move {
            let mut delay = Duration::from_millis(250);
            let sub = loop {
                match Subscriber::connect(&sub_url, "").await {
                    Ok(s) => break s,
                    Err(e) => {
                        warn!(?e, "zmq subscriber connect failed, retrying");
                        tokio::time::sleep(delay).await;
                        delay = (delay * 2).min(Duration::from_secs(10));
                    }
                }
            };
            run_subscriber(sub, bus).await;
        });
    } else {
        info!("ZEROVPN_EVENTS__SUBSCRIBER_CONNECT not set; skipping ZMQ subscriber");
    }

    let app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/ready", get(routes::health::ready))
        .nest(
            "/api/v1",
            Router::new()
                .route("/ping", get(routes::health::ping))
                .route("/auth/register", post(routes::auth::register))
                .route("/auth/login", post(routes::auth::login))
                .route("/auth/logout", post(routes::auth::logout))
                .route("/me", get(routes::auth::me))
                .route(
                    "/devices",
                    get(routes::devices::list).post(routes::devices::create),
                )
                .route(
                    "/devices/{id}",
                    get(routes::devices::get).delete(routes::devices::delete),
                )
                .route("/devices/{id}/pause", post(routes::devices::pause))
                .route("/devices/{id}/unpause", post(routes::devices::unpause))
                .route("/devices/{id}/dns", axum::routing::put(routes::dns::set))
                .route("/devices/{id}/bandwidth", get(routes::bandwidth::for_device))
                .route("/bandwidth", get(routes::bandwidth::for_user))
                .route("/auth/totp/setup", post(routes::totp::setup))
                .route("/auth/totp/enable", post(routes::totp::enable))
                .route("/auth/totp/disable", post(routes::totp::disable))
                .route("/me/data-export", get(routes::me::export))
                .route(
                    "/me/account",
                    axum::routing::delete(routes::me::delete_account),
                )
                .route("/admin/users", get(routes::admin::list_users))
                .route(
                    "/admin/users/{id}/status",
                    axum::routing::put(routes::admin::set_user_status),
                )
                .route("/admin/audit", get(routes::admin::list_audit))
                .route("/admin/failed-logins", get(routes::admin::list_failed_logins))
                .route(
                    "/admin/maintenance",
                    get(routes::admin::get_maintenance).put(routes::admin::set_maintenance),
                )
                .route("/ws", get(routes::ws::ws)),
        )
        .layer(session_layer)
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

async fn run_subscriber(mut sub: Subscriber, bus: tokio::sync::broadcast::Sender<Event>) {
    info!("zmq subscriber loop started");
    loop {
        match sub.recv().await {
            Ok((topic, event)) => {
                debug!(topic, kind = event_kind(&event), "event received");
                // No receivers? Fine — broadcast just drops. The next WS
                // client that connects starts seeing fresh events.
                let _ = bus.send(event);
            }
            Err(e) => {
                warn!(?e, "zmq subscriber recv error");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

fn event_kind(e: &Event) -> &'static str {
    match e {
        Event::Heartbeat { .. } => "heartbeat",
        Event::StatsDelta { .. } => "stats_delta",
        Event::HandshakeChange { .. } => "handshake_change",
        Event::PeerStatusChanged { .. } => "peer_status_changed",
        Event::DnsUpdated { .. } => "dns_updated",
        Event::ServerHealth { .. } => "server_health",
    }
}
