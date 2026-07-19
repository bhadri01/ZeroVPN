//! Destination IP capture repo. Stores observed flows / destinations per
//! device as ingested by the worker's network capture pipeline.
//!
//! See `migrations/00000000000021_destination_ips.sql` for schema.

use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::PgPool;

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct DestinationIpRow {
    pub id: i64,
    pub device_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub src_ip: String,
    pub src_port: Option<i32>,
    pub dst_ip: String,
    pub dst_port: Option<i32>,
    pub proto: Option<String>,
    pub bytes_in: i64,
    pub bytes_out: i64,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub city_name: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub ended_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// A destination record to insert. `device_id` / `user_id` may be
/// `None` if the mapping couldn't be resolved at write time.
/// Geo fields are optional; they are populated by the GeoIP enrichment
/// pipeline at ingest time.
#[derive(Debug)]
pub struct NewDestinationIp<'a> {
    pub device_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub src_ip: &'a str,
    pub src_port: Option<i32>,
    pub dst_ip: &'a str,
    pub dst_port: Option<i32>,
    pub proto: Option<&'a str>,
    pub bytes_in: i64,
    pub bytes_out: i64,
    pub started_at: OffsetDateTime,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub city_name: Option<String>,
}

pub async fn insert(
    pool: &PgPool,
    NewDestinationIp {
        device_id,
        user_id,
        src_ip,
        src_port,
        dst_ip,
        dst_port,
        proto,
        bytes_in,
        bytes_out,
        started_at,
        latitude,
        longitude,
        country_code,
        country_name,
        city_name,
    }: NewDestinationIp<'_>,
) -> sqlx::Result<i64> {
    let row: (i64,) = sqlx::query_as(
        r#"INSERT INTO destination_ips
              (device_id, user_id, src_ip, src_port, dst_ip, dst_port,
               proto, bytes_in, bytes_out, started_at,
               latitude, longitude, country_code, country_name, city_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING id"#,
    )
    .bind(device_id)
    .bind(user_id)
    .bind(src_ip)
    .bind(src_port)
    .bind(dst_ip)
    .bind(dst_port)
    .bind(proto)
    .bind(bytes_in)
    .bind(bytes_out)
    .bind(started_at)
    .bind(latitude)
    .bind(longitude)
    .bind(country_code)
    .bind(country_name)
    .bind(city_name)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

/// Per-device recent destinations, newest first. `limit` clamped to 500.
pub async fn list_for_device(
    pool: &PgPool,
    device_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<DestinationIpRow>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, DestinationIpRow>(
        r#"SELECT id, device_id, user_id, src_ip, src_port, dst_ip, dst_port,
                  proto, bytes_in, bytes_out, latitude, longitude,
                  country_code, country_name, city_name,
                  started_at, ended_at, created_at
             FROM destination_ips
            WHERE device_id = $1
            ORDER BY started_at DESC, id DESC
            LIMIT $2"#,
    )
    .bind(device_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Per-user recent destinations. `limit` clamped to 500.
pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<DestinationIpRow>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, DestinationIpRow>(
        r#"SELECT id, device_id, user_id, src_ip, src_port, dst_ip, dst_port,
                  proto, bytes_in, bytes_out, latitude, longitude,
                  country_code, country_name, city_name,
                  started_at, ended_at, created_at
             FROM destination_ips
            WHERE user_id = $1
            ORDER BY started_at DESC, id DESC
            LIMIT $2"#,
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

