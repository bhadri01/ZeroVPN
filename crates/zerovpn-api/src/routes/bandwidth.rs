use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;
use zerovpn_db::repos::{bandwidth, devices, server_samples};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::{CurrentUser, RequireAdmin},
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

// ── Raw tick-level history ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    /// RFC3339 lower bound (inclusive). Defaults to 1 hour ago.
    pub from: Option<OffsetDateTime>,
    /// RFC3339 upper bound (exclusive). Defaults to now.
    pub to: Option<OffsetDateTime>,
    /// Row limit. Capped at 10000 server-side.
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct DeviceHistoryPoint {
    pub sampled_at: OffsetDateTime,
    pub rx_bytes: i64,
    pub tx_bytes: i64,
}

#[derive(Debug, Serialize)]
pub struct DeviceHistoryResponse {
    pub device_id: Uuid,
    pub from: OffsetDateTime,
    pub to: OffsetDateTime,
    pub samples: Vec<DeviceHistoryPoint>,
}

/// Per-device raw samples (1 row per poll tick). Backs the "every-moment"
/// detailed chart on DeviceDetail; bound your window or you'll pull a huge
/// payload (~86k rows/day at 1 Hz).
pub async fn device_history(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
    Query(q): Query<HistoryQuery>,
) -> ApiResult<impl IntoResponse> {
    devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;

    let to = q.to.unwrap_or_else(OffsetDateTime::now_utc);
    let from = q.from.unwrap_or(to - time::Duration::hours(1));
    let limit = q.limit.unwrap_or(3600).clamp(1, 10_000);

    let rows = bandwidth::device_raw(&state.pool, id, from, to, limit).await?;
    Ok(Json(DeviceHistoryResponse {
        device_id: id,
        from,
        to,
        samples: rows
            .into_iter()
            .map(|r| DeviceHistoryPoint {
                sampled_at: r.sampled_at,
                rx_bytes: r.rx_bytes,
                tx_bytes: r.tx_bytes,
            })
            .collect(),
    }))
}

#[derive(Debug, Serialize)]
pub struct ServerHistoryPoint {
    pub sampled_at: OffsetDateTime,
    pub total_rx_bytes: i64,
    pub total_tx_bytes: i64,
    pub peer_count: i32,
    pub online_count: i32,
    pub handshake_count: i32,
}

#[derive(Debug, Serialize)]
pub struct ServerHistoryResponse {
    pub server_id: Uuid,
    pub from: OffsetDateTime,
    pub to: OffsetDateTime,
    pub samples: Vec<ServerHistoryPoint>,
}

/// Per-server raw history. Admin-only because it aggregates across users.
pub async fn server_history(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Path(id): Path<Uuid>,
    Query(q): Query<HistoryQuery>,
) -> ApiResult<impl IntoResponse> {
    let to = q.to.unwrap_or_else(OffsetDateTime::now_utc);
    let from = q.from.unwrap_or(to - time::Duration::hours(1));
    let limit = q.limit.unwrap_or(3600).clamp(1, 10_000);

    let rows = server_samples::range(&state.pool, id, from, to, limit).await?;
    Ok(Json(ServerHistoryResponse {
        server_id: id,
        from,
        to,
        samples: rows
            .into_iter()
            .map(|r| ServerHistoryPoint {
                sampled_at: r.sampled_at,
                total_rx_bytes: r.total_rx_bytes,
                total_tx_bytes: r.total_tx_bytes,
                peer_count: r.peer_count,
                online_count: r.online_count,
                handshake_count: r.handshake_count,
            })
            .collect(),
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
