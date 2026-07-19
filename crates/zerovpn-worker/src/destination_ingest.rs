use anyhow::Result;
use serde::Deserialize;
use std::net::SocketAddr;
use time::OffsetDateTime;
use tokio::{io::AsyncBufReadExt, net::TcpListener};
use tracing::{error, info, warn};
use uuid::Uuid;

use zerovpn_core::geo::GeoReader;
use zerovpn_db::PgPool;

#[derive(Debug, Deserialize)]
struct FlowEvent {
    src_ip: String,
    src_port: Option<i32>,
    dst_ip: String,
    dst_port: Option<i32>,
    proto: Option<String>,
    bytes_in: i64,
    bytes_out: i64,
    started_at: Option<OffsetDateTime>,
}

pub async fn run(pool: PgPool, bind: &str) -> Result<()> {
    let addr: SocketAddr = bind.parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!(bind = bind, "destination-ingest listening");

    // Try to load GeoIP database if path is provided
    let geo_reader = match std::env::var("ZEROVPN_GEO_DB_PATH") {
        Ok(path) if !path.is_empty() => match GeoReader::new(&path) {
            Ok(reader) => {
                info!(path = path, "loaded GeoIP database");
                Some(reader)
            }
            Err(e) => {
                warn!(?e, path = path, "failed to load GeoIP database; continuing without geo enrichment");
                None
            }
        },
        _ => None,
    };

    loop {
        let (sock, peer) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                error!(?e, "accept failed");
                continue;
            }
        };
        let pool = pool.clone();
        let geo_reader = geo_reader.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(pool, geo_reader, sock.peer_addr().ok(), sock).await {
                warn!(?e, from = ?peer, "ingest connection handler failed");
            }
        });
    }
}

async fn handle_conn(
    pool: PgPool,
    geo_reader: Option<GeoReader>,
    _peer: Option<SocketAddr>,
    stream: tokio::net::TcpStream,
) -> Result<()> {
    let reader = tokio::io::BufReader::new(stream);
    let mut lines = reader.lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<FlowEvent>(&line) {
            Ok(ev) => {
                let started_at = ev.started_at.unwrap_or_else(OffsetDateTime::now_utc);
                // Try to resolve device/user by src_ip.
                let mapping = resolve_device_by_ip(&pool, &ev.src_ip).await;
                let (device_id, user_id) = match mapping {
                    Ok(Some((did, uid))) => (Some(did), Some(uid)),
                    _ => (None, None),
                };

                // Try to enrich with geo data for destination IP
                let (latitude, longitude, country_code, country_name, city_name) =
                    if let Some(ref reader) = geo_reader {
                        if let Some(geo) = reader.lookup(&ev.dst_ip) {
                            (
                                Some(geo.latitude),
                                Some(geo.longitude),
                                Some(geo.country_code),
                                Some(geo.country_name),
                                geo.city_name,
                            )
                        } else {
                            (None, None, None, None, None)
                        }
                    } else {
                        (None, None, None, None, None)
                    };

                if let Err(e) = zerovpn_db::repos::destination_ips::insert(
                    &pool,
                    zerovpn_db::repos::destination_ips::NewDestinationIp {
                        device_id,
                        user_id,
                        src_ip: &ev.src_ip,
                        src_port: ev.src_port,
                        dst_ip: &ev.dst_ip,
                        dst_port: ev.dst_port,
                        proto: ev.proto.as_deref(),
                        bytes_in: ev.bytes_in,
                        bytes_out: ev.bytes_out,
                        started_at,
                        latitude,
                        longitude,
                        country_code,
                        country_name,
                        city_name,
                    },
                )
                .await
                {
                    warn!(?e, "failed to insert destination_ips row");
                }
            }
            Err(e) => {
                warn!(?e, "invalid flow event JSON");
            }
        }
    }
    Ok(())
}

async fn resolve_device_by_ip(pool: &PgPool, ip: &str) -> sqlx::Result<Option<(Uuid, Uuid)>> {
    let row: Option<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT id, user_id FROM devices WHERE allocated_ip = $1 LIMIT 1",
    )
    .bind(ip)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}
