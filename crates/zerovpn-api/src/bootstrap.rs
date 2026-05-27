use std::{path::PathBuf, sync::Arc};

use ipnetwork::IpNetwork;
use tokio::{fs, io::AsyncWriteExt};
use tracing::{info, warn};
use zerovpn_db::{
    PgPool,
    repos::{devices, servers},
};
use zerovpn_wg::{WgController, ip_alloc::IpAllocator, keys};

use crate::state::IpAllocators;

/// Resolve `(host, port)` from `ZEROVPN_WG__SERVER_ENDPOINT` (documented as
/// `host:port`) with `ZEROVPN_WG__LISTEN_PORT` as the port fallback. Only a
/// single-colon value is split, so a bare IPv6 literal is left intact.
fn resolve_server_endpoint() -> (String, i32) {
    let raw = std::env::var("ZEROVPN_WG__SERVER_ENDPOINT")
        .unwrap_or_else(|_| "localhost".to_string());
    let listen_port: i32 = std::env::var("ZEROVPN_WG__LISTEN_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(51820);
    if raw.matches(':').count() == 1 {
        if let Some((host, port)) = raw.split_once(':') {
            if let Ok(p) = port.parse::<i32>() {
                return (host.to_string(), p);
            }
        }
    }
    (raw, listen_port)
}

/// Re-add every active device's peer to the running WireGuard interface.
///
/// The interface is recreated empty whenever the WG container/process
/// restarts, while runtime peer adds otherwise only happen on device
/// create / key-rotate / unpause. Without this boot-time pass a restart
/// silently drops every tunnel until each device is touched. Idempotent —
/// `wg set peer` and the kernel `configure_peer` are upserts — so it is safe
/// to run on every api start (including hot-reload restarts). No-op on the
/// noop backend and when there are no active devices.
pub async fn reconcile_peers(pool: &PgPool, wg: &Arc<dyn WgController>) -> anyhow::Result<()> {
    // JOIN to pick up each peer's home server's PersistentKeepalive so the live
    // WG interface state matches the per-server setting (default 30s if the
    // column is NULL, though the migration sets a NOT NULL default).
    let rows: Vec<(String, IpNetwork, i16)> = sqlx::query_as(
        "SELECT d.public_key, d.allocated_ip, s.persistent_keepalive
           FROM devices d
           JOIN servers s ON s.id = d.server_id
          WHERE d.status = 'active'",
    )
    .fetch_all(pool)
    .await?;
    let total = rows.len();
    if total == 0 {
        return Ok(());
    }
    let mut restored = 0usize;
    for (public_key, allocated_ip, keepalive) in rows {
        match wg
            .add_peer(&public_key, allocated_ip.ip(), None, keepalive as u16)
            .await
        {
            Ok(()) => restored += 1,
            Err(e) => warn!(?e, %public_key, "reconcile_peers: add_peer failed"),
        }
    }
    info!(restored, total, "reconciled active peers onto WG interface");
    Ok(())
}

/// Resolver IP the wg0 DNS DNAT forwards peer queries to — the CoreDNS
/// (`dnsmasq`) container's stable address. `None`/empty disables the DNAT.
/// See `ZEROVPN_WG__DNS_FORWARD_IP`.
pub(crate) fn dns_forward_ip() -> Option<String> {
    std::env::var("ZEROVPN_WG__DNS_FORWARD_IP")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Build the wg0 `PostUp` / `PostDown` iptables one-liners: base FORWARD +
/// MASQUERADE for internet egress, plus — when a resolver is configured —
/// a DNAT that redirects peer DNS (sent to the tunnel resolver `dns_dest`,
/// i.e. the address peers receive as their DNS server) to the CoreDNS
/// container so `*.vpn.local` names resolve. `%i` is the wg interface,
/// expanded by wg-quick at bring-up. The matching `-D` rules in PostDown
/// tear everything back down cleanly on interface stop.
pub(crate) fn wg_postup_postdown(dns_dest: &str) -> (String, String) {
    const BASE_UP: &str = "iptables -A FORWARD -i %i -j ACCEPT; \
         iptables -A FORWARD -o %i -j ACCEPT; \
         iptables -t nat -A POSTROUTING -o eth+ -j MASQUERADE";
    const BASE_DOWN: &str = "iptables -D FORWARD -i %i -j ACCEPT; \
         iptables -D FORWARD -o %i -j ACCEPT; \
         iptables -t nat -D POSTROUTING -o eth+ -j MASQUERADE";
    match dns_forward_ip() {
        Some(fwd) => {
            let up = format!(
                "{BASE_UP}; \
                 iptables -t nat -A PREROUTING -i %i -d {dst} -p udp --dport 53 -j DNAT --to-destination {fwd}:53; \
                 iptables -t nat -A PREROUTING -i %i -d {dst} -p tcp --dport 53 -j DNAT --to-destination {fwd}:53; \
                 iptables -t nat -A POSTROUTING -d {fwd} -p udp --dport 53 -j MASQUERADE; \
                 iptables -t nat -A POSTROUTING -d {fwd} -p tcp --dport 53 -j MASQUERADE",
                dst = dns_dest,
            );
            let down = format!(
                "{BASE_DOWN}; \
                 iptables -t nat -D PREROUTING -i %i -d {dst} -p udp --dport 53 -j DNAT --to-destination {fwd}:53; \
                 iptables -t nat -D PREROUTING -i %i -d {dst} -p tcp --dport 53 -j DNAT --to-destination {fwd}:53; \
                 iptables -t nat -D POSTROUTING -d {fwd} -p udp --dport 53 -j MASQUERADE; \
                 iptables -t nat -D POSTROUTING -d {fwd} -p tcp --dport 53 -j MASQUERADE",
                dst = dns_dest,
            );
            (up, down)
        }
        None => (BASE_UP.to_string(), BASE_DOWN.to_string()),
    }
}

/// Ensure at least one server row exists. If none, create a default one with
/// a freshly-generated WG keypair, an endpoint pointing at
/// `$ZEROVPN_WG__SERVER_ENDPOINT`, and a CIDR of `10.10.0.0/22` (1022 usable
/// hosts, fits 1000+ peers). Also writes `wg0.conf` to the shared
/// `wg_config` volume so the WG container can bring the interface up.
pub async fn ensure_default_server(pool: &PgPool) -> anyhow::Result<()> {
    let (endpoint_host, listen_port) = resolve_server_endpoint();

    if servers::count(pool).await? > 0 {
        // Dev convenience: re-sync the default server's endpoint from the
        // configured value on each boot so a changing Wi-Fi/LAN IP is picked
        // up automatically (peer configs embed this as the `Endpoint`). In
        // prod we leave admin-edited endpoints untouched.
        if std::env::var("ZEROVPN_ENVIRONMENT").as_deref() == Ok("dev") {
            let res = sqlx::query(
                "UPDATE servers SET endpoint_host = $1, endpoint_port = $2 \
                 WHERE name = 'default'",
            )
            .bind(&endpoint_host)
            .bind(listen_port)
            .execute(pool)
            .await?;
            if res.rows_affected() > 0 {
                info!(
                    endpoint = %format!("{endpoint_host}:{listen_port}"),
                    "dev: synced default server endpoint from env"
                );
            }
        }
        return Ok(());
    }
    info!("no servers found; creating default");

    let private_key = keys::generate_private_key();
    let public_key = keys::derive_public_key(&private_key)?;

    let cidr: IpNetwork = "10.10.0.0/22".parse().unwrap();
    let dns: IpNetwork = "10.10.0.1/32".parse().unwrap();

    let id = servers::create(
        pool,
        servers::NewServer {
            name: "default",
            region: "local",
            endpoint_host: &endpoint_host,
            endpoint_port: listen_port,
            public_key: &public_key,
            cidr,
            dns_servers: vec![dns],
            mtu: 1420,
        },
    )
    .await?;

    // Write wg0.conf to the shared volume so the wg container has the
    // server keypair on first boot. The path is configurable so it can
    // match wherever the wg image expects to read its config from.
    let conf_path: PathBuf = std::env::var("ZEROVPN_WG__SERVER_CONFIG_PATH")
        .unwrap_or_else(|_| "/wg/wg0.conf".to_string())
        .into();
    let interface = std::env::var("ZEROVPN_WG__INTERFACE").unwrap_or_else(|_| "wg0".into());
    let server_address = "10.10.0.1/22";

    // Peers are handed `dns.ip()` (10.10.0.1) as their DNS server; the
    // PostUp DNAT redirects those queries to the CoreDNS container.
    let (post_up, post_down) = wg_postup_postdown(&dns.ip().to_string());
    let conf = format!(
        "# Auto-generated by zerovpn-api on first boot. Re-deleting this\n\
         # server row in DB will trigger a regeneration on next start.\n\
         [Interface]\n\
         PrivateKey = {private_key}\n\
         Address = {server_address}\n\
         ListenPort = {listen_port}\n\
         SaveConfig = false\n\
         PostUp = {post_up}\n\
         PostDown = {post_down}\n",
    );

    if let Some(parent) = conf_path.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
            warn!(?e, parent = %parent.display(), "could not create wg config dir");
        }
    }
    match fs::File::create(&conf_path).await {
        Ok(mut f) => {
            if let Err(e) = f.write_all(conf.as_bytes()).await {
                warn!(?e, path = %conf_path.display(), "wg0.conf write failed");
            } else {
                let _ = f.sync_all().await;
                info!(server_id = %id, interface, path = %conf_path.display(), "wg0.conf written");
            }
        }
        Err(e) => {
            // Likely the volume isn't mounted (e.g., dev demo without WG
            // container). Log + continue; api still works for the rest of
            // the stack and ShellController will be a no-op anyway.
            warn!(
                ?e,
                path = %conf_path.display(),
                "could not write wg0.conf — WG container will need it injected manually"
            );
        }
    }

    info!(server_id = %id, public_key = %public_key, "default server created");
    Ok(())
}

/// Build per-server IP allocators from the DB on startup. The allocator
/// dispatches internally on the network family — both IPv4 and IPv6
/// servers are seeded with their existing allocations from the
/// `devices` table.
pub async fn build_ip_allocators(pool: &PgPool) -> anyhow::Result<Arc<IpAllocators>> {
    let allocators = Arc::new(IpAllocators::default());
    for s in servers::list_active(pool).await? {
        let alloc = Arc::new(IpAllocator::new(s.cidr));
        for ip in devices::allocated_ips_for_server(pool, s.id).await? {
            if let Err(e) = alloc.mark_allocated(ip) {
                warn!(server_id = %s.id, %ip, err = ?e, "failed to seed allocator");
            }
        }
        allocators.insert(s.id, alloc);
    }
    info!(servers = allocators.map.read().len(), "ip allocators built");
    Ok(allocators)
}
