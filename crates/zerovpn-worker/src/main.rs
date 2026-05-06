use std::{env, time::Duration};

use anyhow::{Context, Result};
use tokio::signal;
use tracing::{error, info, warn};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};
use zerovpn_events::Publisher;
use zerovpn_wire::Event;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    init_tracing();
    info!(version = env!("CARGO_PKG_VERSION"), "zerovpn-worker starting");

    let pub_bind = env::var("ZEROVPN_EVENTS_PUBLISHER_BIND")
        .unwrap_or_else(|_| "tcp://0.0.0.0:5555".to_string());

    let mut publisher = Publisher::bind(&pub_bind)
        .await
        .context("zmq publisher bind")?;

    let heartbeat = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(5));
        loop {
            ticker.tick().await;
            let ts_ms = time::OffsetDateTime::now_utc().unix_timestamp() * 1000;
            let event = Event::Heartbeat { ts_ms };
            if let Err(e) = publisher.publish("events.heartbeat", &event).await {
                warn!(?e, "heartbeat publish failed");
            } else {
                tracing::debug!("heartbeat published");
            }
        }
    });

    shutdown_signal().await;
    heartbeat.abort();
    info!("zerovpn-worker stopped");
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
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => info!("ctrl-c received"),
        _ = terminate => info!("sigterm received"),
    }
}
