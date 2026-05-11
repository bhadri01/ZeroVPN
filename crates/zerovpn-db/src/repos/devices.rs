use std::net::IpAddr;

use ipnetwork::IpNetwork;
use uuid::Uuid;
use zerovpn_core::models::{Device, DeviceOs, DeviceStatus};

use crate::PgPool;

pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<Device>> {
    sqlx::query_as::<_, Device>(
        r#"SELECT id, user_id, server_id, name, os, public_key, allocated_ip, status,
                  dns_names, allowed_ips_override, dns_override,
                  last_handshake_at, created_at
           FROM devices
           WHERE user_id = $1 AND status <> 'revoked'
           ORDER BY created_at DESC"#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn find_for_user(
    pool: &PgPool,
    user_id: Uuid,
    device_id: Uuid,
) -> sqlx::Result<Option<Device>> {
    sqlx::query_as::<_, Device>(
        r#"SELECT id, user_id, server_id, name, os, public_key, allocated_ip, status,
                  dns_names, allowed_ips_override, dns_override,
                  last_handshake_at, created_at
           FROM devices
           WHERE user_id = $1 AND id = $2"#,
    )
    .bind(user_id)
    .bind(device_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_by_server(pool: &PgPool, server_id: Uuid) -> sqlx::Result<Vec<Device>> {
    sqlx::query_as::<_, Device>(
        r#"SELECT id, user_id, server_id, name, os, public_key, allocated_ip, status,
                  dns_names, allowed_ips_override, dns_override,
                  last_handshake_at, created_at
           FROM devices
           WHERE server_id = $1"#,
    )
    .bind(server_id)
    .fetch_all(pool)
    .await
}

pub async fn count_active_for_server(pool: &PgPool, server_id: Uuid) -> sqlx::Result<i64> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM devices WHERE server_id = $1 AND status = 'active'",
    )
    .bind(server_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub struct NewDevice<'a> {
    pub user_id: Uuid,
    pub server_id: Uuid,
    pub name: &'a str,
    pub os: DeviceOs,
    pub public_key: &'a str,
    pub preshared_key_encrypted: Option<&'a [u8]>,
    pub allocated_ip: IpNetwork,
}

pub async fn create(pool: &PgPool, d: NewDevice<'_>) -> sqlx::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO devices (id, user_id, server_id, name, os, public_key,
                                preshared_key_encrypted, allocated_ip)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
    )
    .bind(id)
    .bind(d.user_id)
    .bind(d.server_id)
    .bind(d.name)
    .bind(d.os)
    .bind(d.public_key)
    .bind(d.preshared_key_encrypted)
    .bind(d.allocated_ip)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn set_status(
    pool: &PgPool,
    user_id: Uuid,
    device_id: Uuid,
    status: DeviceStatus,
) -> sqlx::Result<u64> {
    let res = sqlx::query(
        "UPDATE devices SET status = $3 WHERE user_id = $1 AND id = $2",
    )
    .bind(user_id)
    .bind(device_id)
    .bind(status)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

pub async fn set_dns_names(
    pool: &PgPool,
    user_id: Uuid,
    device_id: Uuid,
    names: &[String],
) -> sqlx::Result<u64> {
    let res = sqlx::query(
        "UPDATE devices SET dns_names = $3 WHERE user_id = $1 AND id = $2",
    )
    .bind(user_id)
    .bind(device_id)
    .bind(names)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// `public_key → (device_id, user_id, server_id)` lookup so the WG poller
/// can attribute each `wg show dump` line and roll per-tick stats up to
/// the owning server.
pub async fn pubkey_index(
    pool: &PgPool,
) -> sqlx::Result<std::collections::HashMap<String, (Uuid, Uuid, Uuid)>> {
    let rows: Vec<(String, Uuid, Uuid, Uuid)> = sqlx::query_as(
        "SELECT public_key, id, user_id, server_id
           FROM devices WHERE status <> 'revoked'",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(pk, id, uid, sid)| (pk, (id, uid, sid)))
        .collect())
}

/// Update last_handshake_at without churning rows when the value didn't change.
pub async fn touch_handshake(
    pool: &PgPool,
    device_id: Uuid,
    handshake_at: time::OffsetDateTime,
) -> sqlx::Result<u64> {
    let res = sqlx::query(
        "UPDATE devices SET last_handshake_at = $2
          WHERE id = $1 AND (last_handshake_at IS NULL OR last_handshake_at < $2)",
    )
    .bind(device_id)
    .bind(handshake_at)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// All allocated IPs for a server, used to seed the in-memory bitmap on boot.
pub async fn allocated_ips_for_server(pool: &PgPool, server_id: Uuid) -> sqlx::Result<Vec<IpAddr>> {
    let rows: Vec<(IpNetwork,)> = sqlx::query_as(
        "SELECT allocated_ip FROM devices WHERE server_id = $1 AND status <> 'revoked'",
    )
    .bind(server_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(n,)| n.ip()).collect())
}

/// Returns all DNS names registered across all peers — used for unique-name
/// validation in the app layer until the side-table moves to 1B.
pub async fn all_dns_names(pool: &PgPool) -> sqlx::Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT unnest(dns_names) FROM devices WHERE status <> 'revoked'",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(n,)| n).collect())
}

/// Active devices in the deployment (used to render the dnsmasq hosts file).
pub async fn list_active_with_dns(pool: &PgPool) -> sqlx::Result<Vec<(Uuid, IpAddr, Vec<String>)>> {
    let rows: Vec<(Uuid, IpNetwork, Vec<String>)> = sqlx::query_as(
        r#"SELECT id, allocated_ip, dns_names
           FROM devices
           WHERE status = 'active' AND array_length(dns_names, 1) > 0"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id, n, dns)| (id, n.ip(), dns)).collect())
}

// FromRow on Device is derived in zerovpn-core::models.
