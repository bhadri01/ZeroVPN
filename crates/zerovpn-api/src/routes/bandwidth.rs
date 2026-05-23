use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use zerovpn_db::repos::{bandwidth, candles, devices, server_samples};
use zerovpn_db::repos::candles::Timeframe;

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::{CurrentUser, RequireAdmin},
    state::AppState,
};

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct RangeQuery {
    /// "24h", "7d", "30d" — defaults to 24h.
    #[serde(default)]
    pub range: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Bucket {
    #[serde(with = "time::serde::rfc3339")]
    pub bucket_start: OffsetDateTime,
    pub rx_bytes: i64,
    pub tx_bytes: i64,
}

impl From<bandwidth::BandwidthBucket> for Bucket {
    fn from(b: bandwidth::BandwidthBucket) -> Self {
        Self { bucket_start: b.bucket_start, rx_bytes: b.rx_bytes, tx_bytes: b.tx_bytes }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BandwidthResponse {
    pub bucket: &'static str, // "hour" or "day"
    pub range: String,
    pub buckets: Vec<Bucket>,
}

/// Per-device bandwidth history.
#[utoipa::path(
    get,
    path = "/devices/{id}/bandwidth",
    tag = "Bandwidth",
    params(
        ("id" = uuid::Uuid, Path, description = "Device UUID"),
        RangeQuery,
    ),
    responses(
        (status = 200, description = "Bucketed rx/tx history", body = BandwidthResponse),
        (status = 400, description = "Invalid range"),
        (status = 404, description = "Device not found"),
    ),
    security(("session_cookie" = [])),
)]
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

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct HistoryQuery {
    /// RFC3339 lower bound (inclusive). Defaults to 1 hour ago.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub from: Option<OffsetDateTime>,
    /// RFC3339 upper bound (exclusive). Defaults to now.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub to: Option<OffsetDateTime>,
    /// Row limit. Capped at 10000 server-side.
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeviceHistoryPoint {
    #[serde(with = "time::serde::rfc3339")]
    pub sampled_at: OffsetDateTime,
    pub rx_bytes: i64,
    pub tx_bytes: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeviceHistoryResponse {
    pub device_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub from: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub to: OffsetDateTime,
    pub samples: Vec<DeviceHistoryPoint>,
}

/// Per-device raw samples (1 row per poll tick). Backs the "every-moment"
/// detailed chart on DeviceDetail; bound your window or you'll pull a huge
/// payload (~86k rows/day at 1 Hz).
#[utoipa::path(
    get,
    path = "/devices/{id}/history",
    tag = "Bandwidth",
    params(
        ("id" = uuid::Uuid, Path, description = "Device UUID"),
        HistoryQuery,
    ),
    responses(
        (status = 200, description = "Raw rx/tx samples in the requested window", body = DeviceHistoryResponse),
        (status = 404, description = "Device not found"),
    ),
    security(("session_cookie" = [])),
)]
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

#[derive(Debug, Serialize, ToSchema)]
pub struct ServerHistoryPoint {
    #[serde(with = "time::serde::rfc3339")]
    pub sampled_at: OffsetDateTime,
    pub total_rx_bytes: i64,
    pub total_tx_bytes: i64,
    pub peer_count: i32,
    pub online_count: i32,
    pub handshake_count: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ServerHistoryResponse {
    pub server_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub from: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub to: OffsetDateTime,
    pub samples: Vec<ServerHistoryPoint>,
}

/// Per-server raw history. Admin-only because it aggregates across users.
#[utoipa::path(
    get,
    path = "/servers/{id}/history",
    tag = "Admin",
    params(
        ("id" = uuid::Uuid, Path, description = "Server UUID"),
        HistoryQuery,
    ),
    responses(
        (status = 200, description = "Per-server aggregate samples", body = ServerHistoryResponse),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
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
#[utoipa::path(
    get,
    path = "/bandwidth",
    tag = "Bandwidth",
    params(RangeQuery),
    responses(
        (status = 200, description = "User-aggregate bucketed bandwidth", body = BandwidthResponse),
        (status = 400, description = "Invalid range"),
    ),
    security(("session_cookie" = [])),
)]
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

// ── OHLC bandwidth candles (trading-style HL + average) ─────────────────────

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct CandleQuery {
    /// Timeframe: 1m | 3m | 5m | 15m | 30m | 1h | 1d | 7d | 1mo. Defaults to 1m.
    #[serde(default)]
    pub tf: Option<String>,
    /// Number of candles (newest-trailing). Capped at 1000; defaults to 120.
    pub limit: Option<i64>,
    /// Pagination cursor (RFC3339). When set, only candles strictly older than
    /// this are returned — lets the chart page backwards as the user pans left.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub before: Option<OffsetDateTime>,
}

/// One candle: high/low of the per-second rate (bits/sec) over the timeframe,
/// plus the true average (Σrate / Σsamples). RX and TX are charted overlaid.
#[derive(Debug, Serialize, ToSchema)]
pub struct CandleDto {
    #[serde(with = "time::serde::rfc3339")]
    pub bucket_start: OffsetDateTime,
    pub rx_high: i64,
    pub rx_low: i64,
    pub rx_avg: i64,
    pub tx_high: i64,
    pub tx_low: i64,
    pub tx_avg: i64,
}

impl From<candles::Candle> for CandleDto {
    fn from(c: candles::Candle) -> Self {
        Self {
            bucket_start: c.bucket_start,
            rx_high: c.rx_high,
            rx_low: c.rx_low,
            rx_avg: c.rx_avg,
            tx_high: c.tx_high,
            tx_low: c.tx_low,
            tx_avg: c.tx_avg,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CandleResponse {
    pub tf: String,
    pub candles: Vec<CandleDto>,
}

fn parse_tf(tf: Option<String>) -> ApiResult<(Timeframe, String)> {
    let s = tf.unwrap_or_else(|| "1m".into());
    let parsed = Timeframe::parse(&s).ok_or_else(|| {
        ApiError::Validation(format!(
            "tf must be 1m | 3m | 5m | 15m | 30m | 1h | 1d | 7d | 1mo (got {s})"
        ))
    })?;
    Ok((parsed, s))
}

/// Per-device bandwidth candles. The 1-minute base is the source of truth;
/// coarser timeframes are derived on read (and 1d/7d/1mo from a daily rollup).
#[utoipa::path(
    get,
    path = "/devices/{id}/candles",
    tag = "Bandwidth",
    params(
        ("id" = uuid::Uuid, Path, description = "Device UUID"),
        CandleQuery,
    ),
    responses(
        (status = 200, description = "OHLC bandwidth candles", body = CandleResponse),
        (status = 400, description = "Invalid timeframe"),
        (status = 404, description = "Device not found"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn device_candles(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
    Query(q): Query<CandleQuery>,
) -> ApiResult<impl IntoResponse> {
    devices::find_for_user(&state.pool, user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;

    let (tf, tf_str) = parse_tf(q.tf)?;
    let limit = q.limit.unwrap_or(120).clamp(1, 1000);
    let rows = candles::device_candles(&state.pool, id, tf, q.before, limit).await?;
    Ok(Json(CandleResponse {
        tf: tf_str,
        candles: rows.into_iter().map(Into::into).collect(),
    }))
}

/// Per-server aggregate candles (summed across all peers). Admin-only.
#[utoipa::path(
    get,
    path = "/servers/{id}/candles",
    tag = "Admin",
    params(
        ("id" = uuid::Uuid, Path, description = "Server UUID"),
        CandleQuery,
    ),
    responses(
        (status = 200, description = "Server-aggregate OHLC candles", body = CandleResponse),
        (status = 400, description = "Invalid timeframe"),
        (status = 403, description = "Not an admin"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn server_candles(
    State(state): State<AppState>,
    RequireAdmin(_admin): RequireAdmin,
    Path(id): Path<Uuid>,
    Query(q): Query<CandleQuery>,
) -> ApiResult<impl IntoResponse> {
    let (tf, tf_str) = parse_tf(q.tf)?;
    let limit = q.limit.unwrap_or(120).clamp(1, 1000);
    let rows = candles::server_candles(&state.pool, id, tf, q.before, limit).await?;
    Ok(Json(CandleResponse {
        tf: tf_str,
        candles: rows.into_iter().map(Into::into).collect(),
    }))
}

/// User-aggregate candles across all of the caller's devices — backs the
/// dashboard "All devices" bandwidth chart.
#[utoipa::path(
    get,
    path = "/candles",
    tag = "Bandwidth",
    params(CandleQuery),
    responses(
        (status = 200, description = "User-aggregate OHLC candles", body = CandleResponse),
        (status = 400, description = "Invalid timeframe"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn user_candles(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<CandleQuery>,
) -> ApiResult<impl IntoResponse> {
    let (tf, tf_str) = parse_tf(q.tf)?;
    let limit = q.limit.unwrap_or(120).clamp(1, 1000);
    let rows = candles::user_candles(&state.pool, user.id, tf, q.before, limit).await?;
    Ok(Json(CandleResponse {
        tf: tf_str,
        candles: rows.into_iter().map(Into::into).collect(),
    }))
}
