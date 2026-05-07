use std::{collections::HashMap, env, time::Duration};

use anyhow::{Context, Result};
use rand::{Rng, RngCore};
use tokio::{signal, sync::mpsc};
use tracing::{debug, error, info, warn};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};
use uuid::Uuid;
use zerovpn_db::{PgPool, repos::devices};
use zerovpn_events::Publisher;
use zerovpn_wire::Event;

mod stats_sim;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    init_tracing();
    info!(version = env!("CARGO_PKG_VERSION"), "zerovpn-worker starting");

    let pub_bind = env::var("ZEROVPN_EVENTS__PUBLISHER_BIND")
        .unwrap_or_else(|_| "tcp://0.0.0.0:5555".to_string());
    let database_url =
        env::var("ZEROVPN_DATABASE_URL").context("ZEROVPN_DATABASE_URL is required")?;

    let pool = zerovpn_db::init_pool(&database_url, 4)
        .await
        .context("connect db")?;
    info!("db connected");

    let mut publisher = Publisher::bind(&pub_bind).await.context("zmq publisher bind")?;

    // Channel funnels events from many tasks to a single publisher task.
    // (zeromq Publisher isn't Sync.)
    let (tx, mut rx) = mpsc::channel::<(String, Event)>(256);

    // Heartbeat task — proves the bus end-to-end and lets the API confirm
    // worker liveness.
    {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(5));
            loop {
                ticker.tick().await;
                let ts_ms = time::OffsetDateTime::now_utc().unix_timestamp() * 1000;
                if tx
                    .send(("events.heartbeat".to_string(), Event::Heartbeat { ts_ms }))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
    }

    // Stats simulation task — queries active devices every 30s and emits a
    // StatsDelta for each. Real WG poller replaces this in 1B-C.
    {
        let pool = pool.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            stats_sim::run(pool, tx).await;
        });
    }

    // Single publisher task drains the channel onto the ZMQ socket.
    let publisher_task = tokio::spawn(async move {
        while let Some((topic, event)) = rx.recv().await {
            if let Err(e) = publisher.publish(&topic, &event).await {
                warn!(topic, ?e, "publish failed");
            } else {
                debug!(topic, "published");
            }
        }
    });

    shutdown_signal().await;
    publisher_task.abort();
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

#[allow(dead_code)]
fn _unused_helpers(_: &Uuid, _: &mut HashMap<(), ()>, _: &mut dyn RngCore) {
    let _ = rand::thread_rng().gen_range(0..1);
}

// `devices` import is used only inside stats_sim; this avoid-unused trick
// keeps the workspace compile clean if the module is feature-gated later.
#[allow(unused_imports)]
use devices as _devices_unused;
#[allow(unused_imports)]
use PgPool as _pgpool_unused;
