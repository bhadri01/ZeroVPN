//! Real WG stats poller.
//!
//! When `ZEROVPN_WG__BACKEND=shell` AND the `wg` binary is in PATH, this
//! task polls `wg show <iface> dump` every `ZEROVPN_STATS_INTERVAL_SECS`
//! and emits `Event::StatsDelta` per peer. Otherwise it falls through to
//! the simulator behavior so the dev demo still works.
//!
//! `wg show <iface> dump` columns (per peer):
//!   public_key  preshared_key  endpoint  allowed_ips  latest_handshake  rx_bytes  tx_bytes  persistent_keepalive
//!
//! Cumulative counters; we keep an in-memory map of last-seen values per
//! public key and emit deltas. Resets (rx/tx going backward) reset the
//! baseline.

use std::{collections::HashMap, time::Duration};

use serde_json::json;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;
use zerovpn_db::{
    PgPool,
    repos::{audit, bandwidth, devices, server_samples, servers},
};
use zerovpn_wire::Event;

#[derive(Default, Clone, Copy)]
struct Cumulative {
    rx: u64,
    tx: u64,
}

pub fn enabled() -> bool {
    std::env::var("ZEROVPN_WG__BACKEND")
        .map(|v| v == "shell")
        .unwrap_or(false)
}

fn poll_interval() -> Duration {
    std::env::var("ZEROVPN_STATS_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(1))
}

fn interface() -> String {
    std::env::var("ZEROVPN_WG__INTERFACE").unwrap_or_else(|_| "wg0".into())
}

pub async fn run(pool: PgPool, tx: mpsc::Sender<(String, Event)>) {
    let interval = poll_interval();
    let iface = interface();
    info!(?interval, %iface, "real WG poller started");
    let mut last: HashMap<String, Cumulative> = HashMap::new();
    // Per-device online flag from the previous tick. Powers transition
    // detection — when the value flips we write an audit_logs row so the
    // device-detail "Activity" timeline can render online/offline
    // events. `None` = "not yet observed this session" (no entry emitted
    // on the very first tick after worker boot, otherwise the timeline
    // would gain a phantom transition for every existing peer).
    let mut prev_online: HashMap<Uuid, bool> = HashMap::new();
    let mut ticker = tokio::time::interval(interval);
    loop {
        ticker.tick().await;
        match poll_once(&pool, &tx, &iface, &mut last, &mut prev_online, interval).await {
            Ok(n) => debug!(peers = n, "wg poll"),
            Err(e) => warn!(?e, "wg poll failed"),
        }
    }
}

async fn poll_once(
    pool: &PgPool,
    tx: &mpsc::Sender<(String, Event)>,
    iface: &str,
    last: &mut HashMap<String, Cumulative>,
    prev_online: &mut HashMap<Uuid, bool>,
    interval: Duration,
) -> anyhow::Result<usize> {
    // Run `wg show <iface> dump`. Output is tab-separated, one peer per line
    // after a header line containing the interface keys. We skip the first
    // line (interface own keys), then parse the rest.
    let out = tokio::process::Command::new("wg")
        .args(["show", iface, "dump"])
        .output()
        .await?;
    if !out.status.success() {
        return Err(anyhow::anyhow!(
            "wg show failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut peers_seen: usize = 0;
    let now = time::OffsetDateTime::now_utc();
    let now_ms = now.unix_timestamp() * 1000;

    // Build a quick lookup of pubkey → (device_id, user_id) so we can
    // attribute each peer line.
    let pk_index = devices::pubkey_index(pool).await?;

    // Per-server rollup. `wg show dump` is per-interface but a single
    // ZeroVPN deployment can map multiple servers onto one interface, so
    // we key by server_id from the pubkey index.
    let mut srv_totals: HashMap<Uuid, (u64, u64, u32, u32, u32)> = HashMap::new();
    let secs = interval.as_secs().max(1);

    let mut lines = stdout.lines();
    let _interface_line = lines.next();
    for line in lines {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 8 {
            continue;
        }
        let public_key = cols[0];
        let latest_handshake: i64 = cols[4].parse().unwrap_or(0);
        let rx_total: u64 = cols[5].parse().unwrap_or(0);
        let tx_total: u64 = cols[6].parse().unwrap_or(0);

        let prev = last.get(public_key).copied().unwrap_or_default();
        // Counter reset (peer reconnect) → take the new value as the delta.
        let drx = if rx_total >= prev.rx { rx_total - prev.rx } else { rx_total };
        let dtx = if tx_total >= prev.tx { tx_total - prev.tx } else { tx_total };
        last.insert(public_key.to_string(), Cumulative { rx: rx_total, tx: tx_total });

        let Some((device_id, user_id, server_id)) = pk_index.get(public_key).copied() else {
            // Peer present in WG but not in our DB — possibly removed
            // mid-cycle. Skip.
            continue;
        };

        // Update last_handshake_at if it changed. Also counts toward the
        // server's per-tick handshake delta (entries that handshook
        // *within this poll interval* — useful for change-rate charts).
        let mut handshake_in_window = false;
        if latest_handshake > 0 {
            let ts = time::OffsetDateTime::from_unix_timestamp(latest_handshake)
                .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
            let _ = devices::touch_handshake(pool, device_id, ts).await;
            let age = now.unix_timestamp() - latest_handshake;
            handshake_in_window = age >= 0 && (age as u64) < secs;
        }

        // Fold into server rollup: (rx, tx, peers, online, handshakes).
        let entry = srv_totals.entry(server_id).or_default();
        entry.0 = entry.0.saturating_add(drx);
        entry.1 = entry.1.saturating_add(dtx);
        entry.2 += 1; // peer_count
        // online = handshake within last ~180s (WG default keepalive scope).
        let online = latest_handshake > 0
            && (now.unix_timestamp() - latest_handshake) < 180;
        if online {
            entry.3 += 1;
        }
        if handshake_in_window {
            entry.4 += 1;
        }

        // Online/offline transition → write an audit row. Skip the very
        // first observation per peer this session so existing peers
        // don't generate a phantom transition the moment the worker
        // restarts. We don't suppress this on counter resets — those
        // are real reconnects worth surfacing.
        if let Some(&was_online) = prev_online.get(&device_id) {
            if was_online != online {
                let action = if online {
                    "device.online"
                } else {
                    "device.offline"
                };
                let last_handshake_ms = latest_handshake.saturating_mul(1000);
                if let Err(e) = audit::record(
                    pool,
                    audit::AuditEntry {
                        actor_user_id: None,
                        action,
                        target_type: Some("device"),
                        target_id: Some(device_id),
                        metadata: json!({
                            "last_handshake_ms": last_handshake_ms,
                            "source": "wg_poller",
                        }),
                        ip_prefix: None,
                    },
                )
                .await
                {
                    warn!(?e, %device_id, online, "audit record (transition) failed");
                }
            }
        }
        prev_online.insert(device_id, online);

        // Peers that have never completed a handshake can still appear in
        // `wg show dump` with non-zero rx/tx counters — these are bytes
        // accepted for the initiator handshake itself, not tunneled
        // traffic. Reporting them as live "rates" makes a brand-new
        // device's card show changing numbers before it has ever
        // connected, which is misleading. Suppress the rate fields when
        // there's no real handshake on record so the live stream only
        // carries traffic for sessions that actually established.
        let report_rates = latest_handshake > 0;

        // Persist the delta for historical aggregation. Without this row
        // the hourly/daily rollups have nothing to sum, so the dashboard
        // chart stays empty in real WG mode. Best-effort — a transient DB
        // error doesn't stop the live broadcast below. Skipped for peers
        // that haven't handshook yet so initiator-handshake bytes don't
        // pollute the history.
        if report_rates && (drx > 0 || dtx > 0) {
            if let Err(e) = bandwidth::insert_sample(
                pool,
                device_id,
                now,
                drx as i64,
                dtx as i64,
            )
            .await
            {
                warn!(?e, %device_id, "bandwidth sample insert failed");
            }
        }

        let event = Event::StatsDelta {
            device_id,
            user_id,
            rx_bytes: if report_rates { drx } else { 0 },
            tx_bytes: if report_rates { dtx } else { 0 },
            rate_rx_bps: if report_rates { drx / secs * 8 } else { 0 },
            rate_tx_bps: if report_rates { dtx / secs * 8 } else { 0 },
            ts_ms: now_ms,
        };
        let topic = format!("stats.peer.{}", device_id);
        if tx.send((topic, event)).await.is_err() {
            return Ok(peers_seen);
        }
        peers_seen += 1;
    }

    // Emit per-server tick. Also persists to server_samples. If wg show
    // returned no peers for a server we still want a zero-tick row so
    // the chart doesn't get a gap on idle stretches — list all active
    // servers and zero-fill the ones not in srv_totals.
    let all_servers = servers::list_active(pool).await.unwrap_or_default();
    for s in all_servers {
        let (srv_rx, srv_tx, peers, online, handshakes) =
            srv_totals.get(&s.id).copied().unwrap_or((0, 0, 0, 0, 0));
        if let Err(e) = server_samples::insert(
            pool,
            s.id,
            now,
            srv_rx as i64,
            srv_tx as i64,
            peers as i32,
            online as i32,
            handshakes as i32,
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
                    rate_rx_bps: srv_rx / secs * 8,
                    rate_tx_bps: srv_tx / secs * 8,
                    peer_count: peers,
                    online_count: online,
                    handshake_count: handshakes,
                    ts_ms: now_ms,
                },
            ))
            .await;
    }

    Ok(peers_seen)
}
