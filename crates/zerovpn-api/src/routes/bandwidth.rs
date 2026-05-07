use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;
use zerovpn_db::repos::{bandwidth, devices};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::CurrentUser,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct RangeQuery {
    /// "24h", "7d", "30d" — defaults to 24h.
    #[serde(default)]
    pub range: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Bucket {
    pub bucket_start: OffsetDateTime,
    pub rx_bytes: i64,
    pub tx_bytes: i64,
}

impl From<bandwidth::BandwidthBucket> for Bucket {
    fn from(b: bandwidth::BandwidthBucket) -> Self {
        Self { bucket_start: b.bucket_start, rx_bytes: b.rx_bytes, tx_bytes: b.tx_bytes }
    }
}

#[derive(Debug, Serialize)]
pub struct BandwidthResponse {
    pub bucket: &'static str, // "hour" or "day"
    pub range: String,
    pub buckets: Vec<Bucket>,
}

/// Per-device bandwidth history.
pub async fn for_device(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
    Query(q): Query<RangeQuery>,
) -> ApiResult<impl IntoResponse> {
    // Authorization: must own the device.
    devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;

    let range = q.range.unwrap_or_else(|| "24h".into());
    let buckets = match range.as_str() {
        "24h" => bandwidth::device_hourly(&state.pool, id, 24).await?,
        "7d" => bandwidth::device_hourly(&state.pool, id, 24 * 7).await?,
        "30d" => bandwidth::device_daily(&state.pool, id, 30).await?,
        other => {
            return Err(ApiError::Validation(format!(
                "range must be 24h | 7d | 30d (got {other})"
            )));
        }
    };
    let bucket = match range.as_str() {
        "30d" => "day",
        _ => "hour",
    };

    Ok(Json(BandwidthResponse {
        bucket,
        range,
        buckets: buckets.into_iter().map(Into::into).collect(),
    }))
}

/// Aggregate across all of a user's devices.
pub async fn for_user(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<RangeQuery>,
) -> ApiResult<impl IntoResponse> {
    let range = q.range.unwrap_or_else(|| "24h".into());
    let (since, bucket) = match range.as_str() {
        "24h" => (OffsetDateTime::now_utc() - time::Duration::hours(24), "hour"),
        "7d" => (OffsetDateTime::now_utc() - time::Duration::days(7), "hour"),
        "30d" => (OffsetDateTime::now_utc() - time::Duration::days(30), "day"),
        other => {
            return Err(ApiError::Validation(format!(
                "range must be 24h | 7d | 30d (got {other})"
            )));
        }
    };

    let buckets = bandwidth::user_totals(&state.pool, user.id, since, bucket).await?;
    Ok(Json(BandwidthResponse {
        bucket: if bucket == "hour" { "hour" } else { "day" },
        range,
        buckets: buckets.into_iter().map(Into::into).collect(),
    }))
}
