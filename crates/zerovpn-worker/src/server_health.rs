//! Host-level system metrics emitter.
//!
//! Polls the OS every `TICK` seconds for CPU%, memory, net I/O, disk I/O,
//! uptime and publishes one `Event::ServerHealth` per active server. Net
//! and disk are exposed as **rates** (bytes/sec since the previous poll),
//! computed from the cumulative counters the OS exposes.
//!
//! Admin-only on the wire — the api's `visible_to` filter drops
//! `ServerHealth` for non-admins (see crates/zerovpn-api/src/routes/ws.rs).

use std::time::{Duration, Instant};

use sysinfo::{Networks, System};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use zerovpn_db::{PgPool, repos::servers};
use zerovpn_wire::Event;

const TICK: Duration = Duration::from_secs(5);
/// Linux /proc/diskstats reports I/O in 512-byte sectors regardless of the
/// device's actual sector size (the kernel scales internally). Multiply by
/// this to get bytes.
const SECTOR_BYTES: u64 = 512;

/// Read /proc/diskstats and return (cumulative sectors read, cumulative
/// sectors written) summed across all "real" block devices — loop, ram,
/// dm-, fd, sr (cdrom) are skipped to avoid inflated numbers from
/// virtual mounts. Returns None on platforms without /proc/diskstats
/// (macOS, Windows, anywhere procfs isn't mounted).
///
/// /proc/diskstats columns (kernel docs / Documentation/iostats.rst):
///   col 3 = device name
///   col 6 = sectors read
///   col 10 = sectors written
fn read_diskstats() -> Option<(u64, u64)> {
    let content = std::fs::read_to_string("/proc/diskstats").ok()?;
    let mut total_read: u64 = 0;
    let mut total_write: u64 = 0;
    for line in content.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 10 {
            continue;
        }
        let name = cols[2];
        if name.starts_with("loop")
            || name.starts_with("ram")
            || name.starts_with("dm-")
            || name.starts_with("fd")
            || name.starts_with("sr")
        {
            continue;
        }
        // Skip partition entries (sda1, nvme0n1p1) so we don't double-count
        // the same I/O that's already attributed to the parent device.
        // Heuristic: partitions end in a digit and the device-without-trailing-
        // digits has a sibling line. Cheap approximation: skip names that
        // contain a digit followed by 'p' or end in a digit *and* aren't
        // a known whole-device name like nvme0n1. Simpler: skip any name
        // ending in a digit when there's a non-digit-ending sibling. For
        // a first cut, just take whole disks (sd[a-z], nvme[0-9]+n[0-9]+,
        // mmcblk[0-9]+, vd[a-z], xvd[a-z]):
        let is_whole = matches!(
            name.chars().next(),
            Some('s') | Some('v') | Some('x') | Some('h') | Some('m') | Some('n')
        ) && !ends_with_partition_suffix(name);
        if !is_whole {
            continue;
        }
        let sectors_read: u64 = cols[5].parse().unwrap_or(0);
        let sectors_written: u64 = cols[9].parse().unwrap_or(0);
        total_read = total_read.saturating_add(sectors_read);
        total_write = total_write.saturating_add(sectors_written);
    }
    Some((total_read, total_write))
}

/// True if the interface looks like a real wire/physical NIC, not a
/// loopback, Docker bridge, VPN tunnel, or other virtual device. Run as
/// a block-list because new physical-NIC name prefixes ship every couple
/// of years (enp*, wlp*, wlan*, en*, eth*, eno*, ens*, …) and the
/// virtual-name space is more stable.
fn is_physical_iface(name: &str) -> bool {
    // Common patterns we never want to count:
    //   lo, lo0           - loopback
    //   docker0, br-*     - docker default bridge & user bridges
    //   veth*             - container virtual ethernet
    //   cni*              - kubernetes CNI plugins
    //   vboxnet*, vmnet*  - VirtualBox / VMware host-only nets
    //   tap*, tun*        - generic tunnel devices
    //   utun*             - macOS tunnel (often VPN apps)
    //   wg*, awg*         - WireGuard / AmneziaWG tunnels (avoid double-
    //                      counting traffic that also flows through eth0)
    //   bridge*, bond*    - aggregations, often duplicates of members
    //   gif*, stf*        - macOS legacy 6-to-4 / tunnel pseudo-devices
    let skip_prefixes = [
        "lo", "docker", "br-", "veth", "cni", "vboxnet", "vmnet", "tap",
        "tun", "utun", "wg", "awg", "bridge", "bond", "gif", "stf", "ipsec",
        "anpi",
    ];
    for p in skip_prefixes {
        if name == p || name.starts_with(p) {
            return false;
        }
    }
    true
}

/// True if the device name looks like a partition rather than a whole disk.
/// `sda1`, `nvme0n1p1`, `mmcblk0p1` → partition. `sda`, `nvme0n1`, `mmcblk0`
/// → whole. Heuristic, intentionally conservative — false positives just
/// mean we drop a real disk from the rollup.
fn ends_with_partition_suffix(name: &str) -> bool {
    // sdXN, hdXN, vdXN, xvdXN — trailing digit on a 3-or-4-char device.
    if let Some(c) = name.chars().last() {
        if c.is_ascii_digit() {
            // nvme0n1, mmcblk0, sda → not partitions despite trailing digit.
            // Partitions have a 'p' or are the digit-suffix on sdXN-style.
            // Whole nvme/mmc have at most one 'n' or one 'blk' segment.
            if name.starts_with("nvme") || name.starts_with("mmcblk") {
                // Whole-disk forms: nvme0n1 / mmcblk0. Partitions: nvme0n1p1 / mmcblk0p1.
                return name.contains('p')
                    && name.rfind('p').map(|i| i > 4).unwrap_or(false);
            }
            // sda1, hda1, vda1, xvda1 → trailing digit IS the partition number.
            return true;
        }
    }
    false
}

pub async fn run(pool: PgPool, tx: mpsc::Sender<(String, Event)>) {
    info!(?TICK, "server_health emitter started");
    let started = Instant::now();
    let mut sys = System::new_all();
    let mut nets = Networks::new_with_refreshed_list();
    // The first refresh primes the deltas — sysinfo's *_received counters
    // report the bytes seen since the previous refresh, so the very first
    // call yields nonsense rates. Burn a tick on initial state.
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    nets.refresh();
    // Disk I/O cumulative baseline. None means /proc/diskstats isn't
    // available on this platform (macOS dev) — we still emit zeros
    // rather than nothing, so the UI doesn't hide the row entirely.
    let mut last_disk = read_diskstats();
    if last_disk.is_none() {
        info!("/proc/diskstats not available; disk I/O will report 0 (non-Linux host)");
    }
    let mut ticker = tokio::time::interval(TICK);
    ticker.tick().await; // first tick is immediate; skip it.

    loop {
        ticker.tick().await;
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        nets.refresh();

        // CPU: average across logical cores.
        let cpu_pct = {
            let cpus = sys.cpus();
            if cpus.is_empty() {
                0.0
            } else {
                cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
            }
        };

        let mem_used_bytes = sys.used_memory();
        let mem_total_bytes = sys.total_memory();

        // Net I/O: sum byte deltas since the previous refresh across
        // *real* network interfaces only. We skip loopback, Docker /
        // container virtual bridges, WireGuard tunnels (would double-count
        // traffic that also exits via the physical NIC), and other VPN
        // tunnels. What's left is the user-meaningful "wire" traffic.
        let secs = TICK.as_secs().max(1);
        let mut net_rx_total: u64 = 0;
        let mut net_tx_total: u64 = 0;
        for (iface, data) in nets.iter() {
            if !is_physical_iface(iface) {
                continue;
            }
            net_rx_total = net_rx_total.saturating_add(data.received());
            net_tx_total = net_tx_total.saturating_add(data.transmitted());
        }
        let net_rx_bps = net_rx_total / secs * 8;
        let net_tx_bps = net_tx_total / secs * 8;

        // Disk I/O: read current cumulative sectors, diff against the last
        // sample, convert to bytes/sec. Treat counter resets (a fresh
        // disk hot-plug, etc.) as a fresh baseline rather than reporting
        // negative deltas.
        let (disk_read_bps, disk_write_bps) = match (read_diskstats(), last_disk) {
            (Some(cur), Some(prev)) => {
                let dr = cur.0.saturating_sub(prev.0).saturating_mul(SECTOR_BYTES) / secs;
                let dw = cur.1.saturating_sub(prev.1).saturating_mul(SECTOR_BYTES) / secs;
                last_disk = Some(cur);
                (dr, dw)
            }
            (Some(cur), None) => {
                last_disk = Some(cur);
                (0, 0)
            }
            (None, _) => (0, 0),
        };

        let uptime_sec = started.elapsed().as_secs();
        let now_ms = time::OffsetDateTime::now_utc().unix_timestamp() * 1000;

        // Emit one event per active server. The current v1 model has a
        // single server per deployment, but this loop is forward-compatible.
        let active_servers = match servers::list_active(&pool).await {
            Ok(s) => s,
            Err(e) => {
                warn!(?e, "server_health: list_active failed");
                continue;
            }
        };
        for s in active_servers {
            // active_peers count: cheap query against devices for this server.
            let active_peers =
                zerovpn_db::repos::devices::count_active_for_server(&pool, s.id)
                    .await
                    .unwrap_or(0) as u32;
            let event = Event::ServerHealth {
                server_id: s.id,
                cpu_pct,
                mem_used_bytes,
                mem_total_bytes,
                active_peers,
                disk_read_bps,
                disk_write_bps,
                net_rx_bps,
                net_tx_bps,
                uptime_sec,
                ts_ms: now_ms,
            };
            debug!(
                server = %s.id,
                cpu_pct,
                mem_used_bytes,
                mem_total_bytes,
                disk_read_bps,
                disk_write_bps,
                net_rx_bps,
                net_tx_bps,
                uptime_sec,
                active_peers,
                "server_health emit"
            );
            let topic = format!("events.server.{}", s.id);
            if tx.send((topic, event)).await.is_err() {
                debug!("server_health: channel closed, exiting");
                return;
            }
        }
    }
}
