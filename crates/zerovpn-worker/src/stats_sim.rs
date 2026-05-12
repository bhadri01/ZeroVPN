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
    repos::{bandwidth, devices, server_samples, users},
};
use zerovpn_wire::Event;

/// Poll interval. Configurable via env var. The default is 1s — the
/// "trading-style every-tick" cadence the dashboard expects. Bump it up
/// in resource-constrained deployments where the disk churn becomes a
/// problem.
fn poll_interval() -> Duration {
    std::env::var("ZEROVPN_STATS_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(1))
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
        // Per-server rollup accumulated across this round.
        let mut srv_rx: u64 = 0;
        let mut srv_tx: u64 = 0;
        let mut srv_peers: u32 = 0;
        let mut srv_online: u32 = 0;
        let mut srv_handshakes: u32 = 0;
        for d in devs {
            srv_peers += 1;
            if d.status != zerovpn_core::models::DeviceStatus::Active {
                continue;
            }
            srv_online += 1;
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

            // Bump the per-user monthly counter; auto-pause if the user
            // crossed their cap.
            let total_delta = (rx_bytes + tx_bytes) as i64;
            match users::add_monthly_usage(pool, d.user_id, total_delta).await {
                Ok((current, Some(cap))) if current >= cap => {
                    if d.status == zerovpn_core::models::DeviceStatus::Active {
                        if let Err(e) = devices::set_status(
                            pool,
                            d.user_id,
                            d.id,
                            zerovpn_core::models::DeviceStatus::Paused,
                        )
                        .await
                        {
                            warn!(?e, "auto-pause on quota exceed failed");
                        } else {
                            info!(
                                user_id = %d.user_id,
                                device_id = %d.id,
                                current,
                                cap,
                                "device auto-paused: monthly quota exceeded"
                            );
                            let _ = tx
                                .send((
                                    format!("events.user.{}", d.user_id),
                                    Event::PeerStatusChanged {
                                        device_id: d.id,
                                        user_id: d.user_id,
                                        status: zerovpn_wire::PeerStatus::Paused,
                                    },
                                ))
                                .await;
                        }
                    }
                }
                Ok(_) => {}
                Err(e) => warn!(?e, "monthly usage update failed"),
            }

            // Fold into the per-server tick rollup.
            srv_rx = srv_rx.saturating_add(rx_bytes);
            srv_tx = srv_tx.saturating_add(tx_bytes);
            // Simulator pretends every active peer "handshook" this tick;
            // the real WG poller computes this from `latest_handshake`.
            srv_handshakes += 1;

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

        // Persist + broadcast the per-server tick. Done after the peer
        // loop so peer-level events get out first (lower latency on
        // the visible per-device sparkline path).
        let secs = interval.as_secs().max(1);
        let srv_rate_rx = srv_rx / secs * 8;
        let srv_rate_tx = srv_tx / secs * 8;
        if let Err(e) = server_samples::insert(
            pool,
            s.id,
            now,
            srv_rx as i64,
            srv_tx as i64,
            srv_peers as i32,
            srv_online as i32,
            srv_handshakes as i32,
        )
        .await
        {
            warn!(server = %s.id, ?e, "server_sample insert failed");
        }
        let _ = tx
            .send((
                format!("stats.server.{}", s.id),
                Event::ServerSample {
                    server_id: s.id,
                    total_rx_bytes: srv_rx,
                    total_tx_bytes: srv_tx,
                    rate_rx_bps: srv_rate_rx,
                    rate_tx_bps: srv_rate_tx,
                    peer_count: srv_peers,
                    online_count: srv_online,
                    handshake_count: srv_handshakes,
                    ts_ms: now_ms,
                },
            ))
            .await;
    }
    Ok(count)
}
