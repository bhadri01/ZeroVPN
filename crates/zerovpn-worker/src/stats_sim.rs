//! Simulated stats emitter for Phase 1B-B.
//!
//! Until the real WG poller (1B-C) wires `wg show dump`, this task queries
//! active devices from the DB every 30s and emits a `StatsDelta` for each
//! one with bounded-random RX/TX values. The frontend topology graph treats
//! these exactly the same as real deltas, so we can prove the entire wire
//! end-to-end (worker → ZMQ → api → WebSocket → browser canvas) without a
//! live WireGuard interface.

use std::time::Duration;

use rand::Rng;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use zerovpn_db::{
    PgPool,
    repos::{bandwidth, devices},
};
use zerovpn_wire::Event;

/// Poll interval. Configurable via env var so smoke tests can run on a
/// faster cadence than production. Defaults to 10s in dev to make the
/// topology graph come alive immediately; real-WG poller arrives in 1B-C
/// and runs at 30s in prod.
fn poll_interval() -> Duration {
    std::env::var("ZEROVPN_STATS_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(10))
}

pub async fn run(pool: PgPool, tx: mpsc::Sender<(String, Event)>) {
    let interval = poll_interval();
    info!(?interval, "stats simulator started");
    let mut ticker = tokio::time::interval(interval);
    // The first immediate tick is wanted — emit on boot so the dashboard
    // doesn't sit idle for the full window.
    loop {
        ticker.tick().await;
        match emit_round(&pool, &tx, interval).await {
            Ok(n) => debug!(devices = n, "emitted stats round"),
            Err(e) => warn!(?e, "stats round failed"),
        }
    }
}

async fn emit_round(
    pool: &PgPool,
    tx: &mpsc::Sender<(String, Event)>,
    interval: Duration,
) -> Result<usize, sqlx::Error> {
    // Iterate active devices across all servers.
    let servers = zerovpn_db::repos::servers::list_active(pool).await?;
    let now = time::OffsetDateTime::now_utc();
    let now_ms = now.unix_timestamp() * 1000;
    let mut count = 0usize;

    for s in servers {
        let devs = devices::list_by_server(pool, s.id).await?;
        for d in devs {
            if d.status != zerovpn_core::models::DeviceStatus::Active {
                continue;
            }
            // Generate the random fields in a tight scope so ThreadRng (which
            // isn't Send) is dropped before we cross the next await point.
            let (rx_bytes, tx_bytes, rate_rx_bps, rate_tx_bps) = {
                let mut rng = rand::thread_rng();
                let busy: bool = rng.gen_bool(0.3);
                let rx: u64 = if busy { rng.gen_range(50_000..2_000_000) } else { rng.gen_range(0..20_000) };
                let tx: u64 = if busy { rng.gen_range(20_000..1_000_000) } else { rng.gen_range(0..10_000) };
                let secs = interval.as_secs().max(1);
                let rate_rx = rx / secs * 8;
                let rate_tx = tx / secs * 8;
                (rx, tx, rate_rx, rate_tx)
            };

            // Persist the delta for historical aggregation. Best effort —
            // a transient DB error doesn't break the live broadcast.
            if let Err(e) = bandwidth::insert_sample(
                pool,
                d.id,
                now,
                rx_bytes as i64,
                tx_bytes as i64,
            )
            .await
            {
                warn!(device = %d.id, ?e, "bandwidth sample insert failed");
            }

            let event = Event::StatsDelta {
                device_id: d.id,
                user_id: d.user_id,
                rx_bytes,
                tx_bytes,
                rate_rx_bps,
                rate_tx_bps,
                ts_ms: now_ms,
            };
            let topic = format!("stats.peer.{}", d.id);
            if tx.send((topic, event)).await.is_err() {
                return Ok(count);
            }
            count += 1;
        }
    }
    Ok(count)
}
