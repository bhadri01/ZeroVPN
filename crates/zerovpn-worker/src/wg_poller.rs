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

use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use zerovpn_db::{PgPool, repos::devices};
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
        .unwrap_or(Duration::from_secs(30))
}

fn interface() -> String {
    std::env::var("ZEROVPN_WG__INTERFACE").unwrap_or_else(|_| "wg0".into())
}

pub async fn run(pool: PgPool, tx: mpsc::Sender<(String, Event)>) {
    let interval = poll_interval();
    let iface = interface();
    info!(?interval, %iface, "real WG poller started");
    let mut last: HashMap<String, Cumulative> = HashMap::new();
    let mut ticker = tokio::time::interval(interval);
    loop {
        ticker.tick().await;
        match poll_once(&pool, &tx, &iface, &mut last).await {
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

        let Some((device_id, user_id)) = pk_index.get(public_key).copied() else {
            // Peer present in WG but not in our DB — possibly removed
            // mid-cycle. Skip.
            continue;
        };

        // Update last_handshake_at if it changed.
        if latest_handshake > 0 {
            let ts = time::OffsetDateTime::from_unix_timestamp(latest_handshake)
                .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
            let _ = devices::touch_handshake(pool, device_id, ts).await;
        }

        let secs = poll_interval().as_secs().max(1);
        let event = Event::StatsDelta {
            device_id,
            user_id,
            rx_bytes: drx,
            tx_bytes: dtx,
            rate_rx_bps: drx / secs * 8,
            rate_tx_bps: dtx / secs * 8,
            ts_ms: now_ms,
        };
        let topic = format!("stats.peer.{}", device_id);
        if tx.send((topic, event)).await.is_err() {
            return Ok(peers_seen);
        }
        peers_seen += 1;
    }
    Ok(peers_seen)
}
