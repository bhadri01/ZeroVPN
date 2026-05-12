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
mod middleware;
mod routes;
mod state;

use state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    init_tracing();
    if let Err(e) = routes::metrics::install_global_recorder() {
        warn!(?e, "prometheus recorder install failed; /metrics will return 503");
    }

    let is_production = env::var("ZEROVPN_ENVIRONMENT").as_deref() == Ok("production");
    validate_production_config(is_production)?;
    info!(
        version = env!("CARGO_PKG_VERSION"),
        environment = if is_production { "production" } else { "dev" },
        "zerovpn-api starting"
    );

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
    // `secure: true` requires the cookie to ride only over HTTPS. Caddy
    // terminates TLS for us in production; in dev we serve over plaintext
    // localhost so the flag is off.
    // Session idle window: 30 minutes in prod (snappy auth turnover), 30
    // days in dev so a cargo restart or an overnight tab doesn't kick you
    // back to /login. Each authenticated request refreshes the window.
    let idle_expiry = if is_production {
        time::Duration::minutes(30)
    } else {
        time::Duration::days(30)
    };
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(is_production)
        .with_http_only(true)
        .with_same_site(tower_sessions::cookie::SameSite::Lax)
        .with_name("zerovpn_session")
        .with_expiry(Expiry::OnInactivity(idle_expiry));

    bootstrap::ensure_default_server(&pool)
        .await
        .context("bootstrap server")?;
    let allocators = bootstrap::build_ip_allocators(&pool)
        .await
        .context("build ip allocators")?;

    let kek_b64 = env::var("ZEROVPN_KEK").context("ZEROVPN_KEK is required")?;
    let kek = zerovpn_auth::kek::Kek::from_b64(&kek_b64)
        .map_err(|e| anyhow::anyhow!("invalid KEK: {e}"))?;

    let public_url =
        env::var("ZEROVPN_PUBLIC_URL").unwrap_or_else(|_| "http://localhost".into());

    // Build a Mailer if SMTP is configured; otherwise routes fall back to
    // logging the link so dev still works without MailHog.
    let mailer = match (env::var("ZEROVPN_SMTP__HOST"), env::var("ZEROVPN_SMTP__PORT")) {
        (Ok(host), Ok(port_str)) if !host.is_empty() => {
            let port: u16 = port_str.parse().unwrap_or(1025);
            let user = env::var("ZEROVPN_SMTP__USERNAME").ok().filter(|s| !s.is_empty());
            let pass = env::var("ZEROVPN_SMTP__PASSWORD").ok().filter(|s| !s.is_empty());
            let from_str = env::var("ZEROVPN_SMTP__FROM")
                .unwrap_or_else(|_| "ZeroVPN <noreply@localhost>".into());
            let from: zerovpn_mail::Mailbox = from_str
                .parse()
                .map_err(|e| anyhow::anyhow!("invalid SMTP_FROM: {e}"))?;
            // dev MailHog has no TLS; flip require_tls=true in prod.
            let require_tls = port != 1025;
            match zerovpn_mail::Mailer::new(
                &host,
                port,
                user.as_deref(),
                pass.as_deref(),
                from,
                require_tls,
            ) {
                Ok(m) => {
                    info!(host, port, "smtp configured");
                    Some(m)
                }
                Err(e) => {
                    warn!(?e, "smtp init failed; mail send will fall back to log");
                    None
                }
            }
        }
        _ => {
            info!("ZEROVPN_SMTP__HOST not set; mail disabled (dev mode)");
            None
        }
    };

    let wg_controller = zerovpn_wg::control::from_env();
    let app_state =
        AppState::new(pool, allocators, kek, mailer, public_url, wg_controller);

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
        .route("/metrics", get(routes::metrics::metrics))
        .route("/openapi.json", get(routes::openapi::spec))
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
                // Bulk-reorder must come BEFORE `/devices/{id}` so axum's
                // matcher doesn't treat "order" as a uuid path segment.
                .route(
                    "/devices/order",
                    axum::routing::put(routes::devices::reorder),
                )
                // Same reason — `dns-check` is a static path, must sit
                // before the `/devices/{id}` catch-all.
                .route(
                    "/devices/dns-check",
                    get(routes::dns::check_availability),
                )
                .route(
                    "/devices/{id}",
                    get(routes::devices::get)
                        .delete(routes::devices::delete)
                        .patch(routes::devices::patch),
                )
                .route("/devices/{id}/pause", post(routes::devices::pause))
                .route("/devices/{id}/unpause", post(routes::devices::unpause))
                .route(
                    "/devices/{id}/rotate-keys",
                    post(routes::devices::rotate_keys),
                )
                .route(
                    "/devices/{id}/conf",
                    get(routes::devices::redownload_conf),
                )
                .route(
                    "/devices/{id}/stored-key",
                    axum::routing::delete(routes::devices::clear_stored_key),
                )
                .route("/devices/{id}/dns", axum::routing::put(routes::dns::set))
                .route("/devices/{id}/events", get(routes::devices::events))
                .route("/devices/{id}/bandwidth", get(routes::bandwidth::for_device))
                .route("/devices/{id}/history", get(routes::bandwidth::device_history))
                .route("/servers/{id}/history", get(routes::bandwidth::server_history))
                .route("/bandwidth", get(routes::bandwidth::for_user))
                .route("/auth/totp/setup", post(routes::totp::setup))
                .route("/auth/totp/enable", post(routes::totp::enable))
                .route("/auth/totp/disable", post(routes::totp::disable))
                .route("/me/data-export", get(routes::me::export))
                .route("/me/server", get(routes::me::server_info))
                .route(
                    "/me/topology",
                    get(routes::me::get_topology).put(routes::me::set_topology),
                )
                .route(
                    "/me/account",
                    axum::routing::delete(routes::me::delete_account),
                )
                .route(
                    "/me/preferences",
                    get(routes::me::get_preferences).put(routes::me::set_preferences),
                )
                .route("/admin/users", get(routes::admin::list_users))
                .route(
                    "/admin/users/{id}/status",
                    axum::routing::put(routes::admin::set_user_status),
                )
                .route("/admin/audit", get(routes::admin::list_audit))
                .route("/admin/audit.csv", get(routes::admin::list_audit_csv))
                .route("/admin/failed-logins", get(routes::admin::list_failed_logins))
                .route(
                    "/admin/maintenance",
                    get(routes::admin::get_maintenance).put(routes::admin::set_maintenance),
                )
                .route(
                    "/admin/users/{id}/quota",
                    axum::routing::put(routes::admin::set_user_quota),
                )
                .route("/admin/servers", get(routes::admin::list_servers))
                .route(
                    "/admin/servers/{id}",
                    axum::routing::patch(routes::admin::patch_server),
                )
                .route(
                    "/admin/servers/{id}/rotate-keys",
                    post(routes::admin::rotate_server_keys),
                )
                .route("/auth/verify-email", post(routes::email_auth::verify_email))
                .route("/auth/resend-verify", post(routes::email_auth::resend_verify))
                .route(
                    "/auth/forgot-password",
                    post(routes::email_auth::forgot_password),
                )
                .route(
                    "/auth/reset-password",
                    post(routes::email_auth::reset_password),
                )
                .route(
                    "/auth/verify-reset-token",
                    post(routes::email_auth::verify_reset_token),
                )
                .route("/ws", get(routes::ws::ws)),
        )
        .layer(axum::middleware::from_fn_with_state(
            app_state.clone(),
            middleware::maintenance_gate,
        ))
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

/// Refuse to boot in production with default / weak / dev-style config.
/// Catches the "you forgot to swap `.env.dev` for `.env.prod`" failure mode
/// before the api ever binds a port.
fn validate_production_config(is_production: bool) -> Result<()> {
    if !is_production {
        return Ok(());
    }

    let session = env::var("ZEROVPN_SESSION_SECRET").unwrap_or_default();
    if session == "CHANGEME" || session.len() < 32 {
        anyhow::bail!(
            "production: ZEROVPN_SESSION_SECRET must be a 32+ byte base64 random; \
             run ./scripts/init-secrets.sh prod"
        );
    }

    let kek = env::var("ZEROVPN_KEK").unwrap_or_default();
    if kek == "CHANGEME" || kek.len() < 32 {
        anyhow::bail!(
            "production: ZEROVPN_KEK must be a 32-byte base64 random; \
             run ./scripts/init-secrets.sh prod"
        );
    }

    let domain = env::var("ZEROVPN_DOMAIN").unwrap_or_default();
    if domain.is_empty()
        || domain == "localhost"
        || domain.starts_with("REPLACE")
    {
        anyhow::bail!(
            "production: ZEROVPN_DOMAIN must be a real public domain (got '{}'); \
             Caddy needs it for Let's Encrypt issuance",
            domain
        );
    }

    let smtp_host = env::var("ZEROVPN_SMTP__HOST").unwrap_or_default();
    if smtp_host == "mailhog" || smtp_host.starts_with("smtp.REPLACE") {
        anyhow::bail!(
            "production: ZEROVPN_SMTP__HOST is still pointing at a dev / placeholder \
             relay ('{}'); set a real SMTP host or unset to disable mail",
            smtp_host
        );
    }

    Ok(())
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
        Event::ServerSample { .. } => "server_sample",
    }
}
