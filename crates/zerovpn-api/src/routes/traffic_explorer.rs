use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use zerovpn_db::repos::devices;

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::RequireAdmin,
    state::AppState,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct DestinationIpResponse {
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
    pub started_at: String,
    pub ended_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct TrafficQuery {
    /// Start time (ISO 8601 format)
    pub from: String,
    /// End time (ISO 8601 format)
    pub to: String,
    /// Number of records to return (max 500)
    #[serde(default)]
    pub limit: Option<i64>,
    /// Pagination offset
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TrafficListResponse {
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
    pub flows: Vec<DestinationIpResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CountryAggregation {
    pub country_code: String,
    pub country_name: String,
    pub flow_count: i64,
    pub total_bytes: i64,
}

/// Get destination IP traffic flows for a device (with date range filtering).
#[utoipa::path(
    get,
    path = "/admin/devices/{device_id}/traffic",
    params(("device_id" = Uuid, Path, description = "Device UUID"), TrafficQuery),
    responses(
        (status = 200, description = "Device traffic flows with pagination", body = TrafficListResponse),
        (status = 422, description = "Invalid date format"),
        (status = 404, description = "Device not found"),
    ),
    security(("session_cookie" = [])),
    tag = "admin",
)]
pub async fn device_traffic(
    State(state): State<AppState>,
    Path(device_id): Path<Uuid>,
    Query(params): Query<TrafficQuery>,
    _admin: RequireAdmin,
) -> ApiResult<Json<TrafficListResponse>> {
    // Verify device exists
    devices::get_by_id(&state.pool, device_id).await?;

    // Parse ISO 8601 timestamps
    let from = OffsetDateTime::parse(&params.from, &time::format_description::well_known::Iso8601::DEFAULT)
        .map_err(|_| ApiError::Validation("invalid 'from' timestamp format (ISO 8601)".into()))?;
    let to = OffsetDateTime::parse(&params.to, &time::format_description::well_known::Iso8601::DEFAULT)
        .map_err(|_| ApiError::Validation("invalid 'to' timestamp format (ISO 8601)".into()))?;

    let limit = params.limit.unwrap_or(100).clamp(1, 500);
    let offset = params.offset.unwrap_or(0).max(0);

    // Get total count and paginated flows
    let total = zerovpn_db::repos::destination_ips::count_for_device_by_date_range(&state.pool, device_id, from, to)
        .await?;
    let rows = zerovpn_db::repos::destination_ips::list_for_device_by_date_range(&state.pool, device_id, from, to, limit, offset)
        .await?;

    let flows = rows.into_iter().map(|row| DestinationIpResponse {
        id: row.id,
        device_id: row.device_id,
        user_id: row.user_id,
        src_ip: row.src_ip,
        src_port: row.src_port,
        dst_ip: row.dst_ip,
        dst_port: row.dst_port,
        proto: row.proto,
        bytes_in: row.bytes_in,
        bytes_out: row.bytes_out,
        latitude: row.latitude,
        longitude: row.longitude,
        country_code: row.country_code,
        country_name: row.country_name,
        city_name: row.city_name,
        started_at: row.started_at.to_string(),
        ended_at: row.ended_at.map(|dt| dt.to_string()),
        created_at: row.created_at.to_string(),
    }).collect();

    Ok(Json(TrafficListResponse {
        total,
        limit,
        offset,
        flows,
    }))
}

/// Get destination IP traffic aggregated by country for a device (heatmap data).
#[utoipa::path(
    get,
    path = "/admin/devices/{device_id}/traffic/by-country",
    params(("device_id" = Uuid, Path, description = "Device UUID"), TrafficQuery),
    responses(
        (status = 200, description = "Country-level traffic aggregations", body = Vec<CountryAggregation>),
        (status = 422, description = "Invalid date format"),
        (status = 404, description = "Device not found"),
    ),
    security(("session_cookie" = [])),
    tag = "admin",
)]
pub async fn device_traffic_by_country(
    State(state): State<AppState>,
    Path(device_id): Path<Uuid>,
    Query(params): Query<TrafficQuery>,
    _admin: RequireAdmin,
) -> ApiResult<Json<Vec<CountryAggregation>>> {
    // Verify device exists
    devices::get_by_id(&state.pool, device_id).await?;

    // Parse ISO 8601 timestamps
    let from = OffsetDateTime::parse(&params.from, &time::format_description::well_known::Iso8601::DEFAULT)
        .map_err(|_| ApiError::Validation("invalid 'from' timestamp format (ISO 8601)".into()))?;
    let to = OffsetDateTime::parse(&params.to, &time::format_description::well_known::Iso8601::DEFAULT)
        .map_err(|_| ApiError::Validation("invalid 'to' timestamp format (ISO 8601)".into()))?;

    let limit = params.limit.unwrap_or(50).clamp(1, 100);

    let rows = zerovpn_db::repos::destination_ips::list_destinations_by_country_for_device(&state.pool, device_id, from, to, limit)
        .await?;

    let aggregations = rows.into_iter().map(|(country_code, country_name, flow_count, total_bytes)| CountryAggregation {
        country_code,
        country_name,
        flow_count,
        total_bytes,
    }).collect();

    Ok(Json(aggregations))
}
