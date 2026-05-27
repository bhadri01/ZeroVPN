use ipnetwork::IpNetwork;
use uuid::Uuid;
use zerovpn_core::models::Server;

use crate::PgPool;

pub async fn list_active(pool: &PgPool) -> sqlx::Result<Vec<Server>> {
    sqlx::query_as::<_, Server>(
        r#"SELECT id, name, region, endpoint_host, endpoint_port, public_key,
                  cidr, dns_servers, mtu, is_active, persistent_keepalive
           FROM servers
           WHERE is_active = TRUE
           ORDER BY name"#,
    )
    .fetch_all(pool)
    .await
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> sqlx::Result<Option<Server>> {
    sqlx::query_as::<_, Server>(
        r#"SELECT id, name, region, endpoint_host, endpoint_port, public_key,
                  cidr, dns_servers, mtu, is_active, persistent_keepalive
           FROM servers
           WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub struct NewServer<'a> {
    pub name: &'a str,
    pub region: &'a str,
    pub endpoint_host: &'a str,
    pub endpoint_port: i32,
    pub public_key: &'a str,
    pub cidr: IpNetwork,
    pub dns_servers: Vec<IpNetwork>,
    pub mtu: i32,
}

pub async fn create(pool: &PgPool, new: NewServer<'_>) -> sqlx::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO servers (id, name, region, endpoint_host, endpoint_port,
                                public_key, cidr, dns_servers, mtu, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)"#,
    )
    .bind(id)
    .bind(new.name)
    .bind(new.region)
    .bind(new.endpoint_host)
    .bind(new.endpoint_port)
    .bind(new.public_key)
    .bind(new.cidr)
    .bind(&new.dns_servers)
    .bind(new.mtu)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn count(pool: &PgPool) -> sqlx::Result<i64> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM servers")
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}
