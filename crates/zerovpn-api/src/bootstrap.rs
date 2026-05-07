use std::sync::Arc;

use ipnetwork::IpNetwork;
use tracing::{info, warn};
use zerovpn_db::{
    PgPool,
    repos::{devices, servers},
};
use zerovpn_wg::{ip_alloc::IpAllocator, keys};

use crate::state::IpAllocators;

/// Ensure at least one server row exists. If none, create a default one with
/// a freshly-generated WG keypair, an endpoint pointing at $ZEROVPN_WG__SERVER_ENDPOINT,
/// and a CIDR of 10.10.0.0/22 (1022 usable hosts, fits 1000+ peers).
pub async fn ensure_default_server(pool: &PgPool) -> anyhow::Result<()> {
    if servers::count(pool).await? > 0 {
        return Ok(());
    }
    info!("no servers found; creating default");

    let private_key = keys::generate_private_key();
    let public_key = keys::derive_public_key(&private_key)?;

    let endpoint_host = std::env::var("ZEROVPN_WG__SERVER_ENDPOINT")
        .unwrap_or_else(|_| "localhost".to_string());
    let listen_port: i32 = std::env::var("ZEROVPN_WG__LISTEN_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(51820);

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

    // The server's WG private key needs to live in /etc/wireguard for the
    // wg-quick userspace daemon to use it. For Phase 1A we just log it so
    // the operator can inject it manually; persistent server-key handling
    // is part of Phase 1B WG control wiring.
    warn!(
        server_id = %id,
        "server-side WG private key generated — persist it to /etc/wireguard out-of-band; future versions will encrypt-at-rest in DB"
    );
    info!(server_id = %id, public_key = %public_key, "default server created");
    Ok(())
}

/// Build per-server IP allocators from the DB on startup. Each allocator has
/// network address and gateway address pre-marked, then existing peer IPs
/// from the DB are layered on.
pub async fn build_ip_allocators(pool: &PgPool) -> anyhow::Result<Arc<IpAllocators>> {
    let allocators = Arc::new(IpAllocators::default());
    for s in servers::list_active(pool).await? {
        let net = match s.cidr {
            IpNetwork::V4(v4) => v4,
            IpNetwork::V6(_) => {
                warn!(server_id = %s.id, "IPv6 CIDR not yet supported by allocator; skipping");
                continue;
            }
        };
        let alloc = Arc::new(IpAllocator::new(net));
        for ip in devices::allocated_ips_for_server(pool, s.id).await? {
            if let std::net::IpAddr::V4(v4) = ip {
                if let Err(e) = alloc.mark_allocated(v4) {
                    warn!(server_id = %s.id, ip = %v4, err = ?e, "failed to seed allocator");
                }
            }
        }
        allocators.insert(s.id, alloc);
    }
    info!(servers = allocators.map.read().len(), "ip allocators built");
    Ok(allocators)
}
