//! Multi-timeframe bandwidth candles (trading-style HL + average).
//!
//! The **1-minute candle** (per device and per server) is the single source
//! of truth — the worker accumulates each peer's per-second rate in memory and
//! flushes one row per peer per minute (HL + Σrate + sample count). Coarser
//! timeframes are derived on read with `date_bin()` / `date_trunc()`:
//! `high = max(high)`, `low = min(low)`, `avg = Σsum / Σsamples`. A daily
//! rollup table backs the long timeframes (1d/7d/1month). Rates are bits/sec.

use time::OffsetDateTime;
use uuid::Uuid;

use crate::PgPool;

/// A completed 1-minute candle ready to flush. `id` is the device_id or
/// server_id depending on which table it's written to.
#[derive(Debug, Clone)]
pub struct CandleRow {
    pub id: Uuid,
    pub bucket_start: OffsetDateTime,
    pub rx_high: i64,
    pub rx_low: i64,
    pub rx_sum: i64,
    pub tx_high: i64,
    pub tx_low: i64,
    pub tx_sum: i64,
    pub samples: i32,
}

/// A read-side candle for the chart (averages computed from Σsum / Σsamples).
#[derive(Debug, Clone, serde::Serialize)]
pub struct Candle {
    #[serde(with = "time::serde::rfc3339")]
    pub bucket_start: OffsetDateTime,
    pub rx_high: i64,
    pub rx_low: i64,
    pub rx_avg: i64,
    pub tx_high: i64,
    pub tx_low: i64,
    pub tx_avg: i64,
}

/// Chart timeframes (candle durations).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Timeframe {
    M1,
    M3,
    M5,
    M15,
    M30,
    H1,
    D1,
    D7,
    Month1,
}

#[derive(Clone, Copy)]
enum Scope {
    Device,
    Server,
}

impl Timeframe {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "1m" => Self::M1,
            "3m" => Self::M3,
            "5m" => Self::M5,
            "15m" => Self::M15,
            "30m" => Self::M30,
            "1h" => Self::H1,
            "1d" => Self::D1,
            "7d" => Self::D7,
            "1mo" => Self::Month1,
            _ => return None,
        })
    }

    /// Coarse timeframes read the daily rollup; fine ones read 1-minute.
    fn uses_daily(self) -> bool {
        matches!(self, Self::D1 | Self::D7 | Self::Month1)
    }

    /// SQL expression that groups `bucket_start` into this timeframe. All
    /// values come from this enum, never user input — safe to interpolate.
    /// The `date_bin` origin is the WireGuard-era epoch (2001-01-01 UTC), an
    /// arbitrary fixed anchor so buckets align identically across queries.
    fn bucket_expr(self) -> &'static str {
        match self {
            Self::M1 => "date_bin(INTERVAL '1 minute', bucket_start, TIMESTAMPTZ '2001-01-01 00:00:00+00')",
            Self::M3 => "date_bin(INTERVAL '3 minutes', bucket_start, TIMESTAMPTZ '2001-01-01 00:00:00+00')",
            Self::M5 => "date_bin(INTERVAL '5 minutes', bucket_start, TIMESTAMPTZ '2001-01-01 00:00:00+00')",
            Self::M15 => "date_bin(INTERVAL '15 minutes', bucket_start, TIMESTAMPTZ '2001-01-01 00:00:00+00')",
            Self::M30 => "date_bin(INTERVAL '30 minutes', bucket_start, TIMESTAMPTZ '2001-01-01 00:00:00+00')",
            Self::H1 => "date_bin(INTERVAL '1 hour', bucket_start, TIMESTAMPTZ '2001-01-01 00:00:00+00')",
            // Daily rollup rows are already 1/day → group by the day itself.
            Self::D1 => "bucket_start",
            Self::D7 => "date_bin(INTERVAL '7 days', bucket_start, TIMESTAMPTZ '2001-01-01 00:00:00+00')",
            // Months aren't a fixed interval — date_bin can't, so truncate.
            Self::Month1 => "date_trunc('month', bucket_start)",
        }
    }
}

async fn query_candles(
    pool: &PgPool,
    scope: Scope,
    id: Uuid,
    tf: Timeframe,
    before: Option<OffsetDateTime>,
    limit: i64,
) -> sqlx::Result<Vec<Candle>> {
    let (table, id_col) = match (scope, tf.uses_daily()) {
        (Scope::Device, false) => ("bandwidth_candles_1m", "device_id"),
        (Scope::Device, true) => ("bandwidth_candles_1d", "device_id"),
        (Scope::Server, false) => ("server_candles_1m", "server_id"),
        (Scope::Server, true) => ("server_candles_1d", "server_id"),
    };
    let bucket = tf.bucket_expr();
    // SUM() over BIGINT/INT widens to NUMERIC in Postgres, which won't decode
    // into Rust i64 — cast each aggregate back to BIGINT. Safe: even a month
    // of daily rows stays well under i64::MAX.
    //
    // `$3` is the optional pagination cursor: when non-NULL we return only
    // candles strictly older than it (newest-first, capped at `limit`), so the
    // chart can lazily page backwards in time as the user pans left.
    let sql = format!(
        "SELECT {bucket} AS bucket, \
                MAX(rx_high), MIN(rx_low), SUM(rx_sum)::bigint, \
                MAX(tx_high), MIN(tx_low), SUM(tx_sum)::bigint, \
                SUM(samples)::bigint \
           FROM {table} \
          WHERE {id_col} = $1 \
            AND ($3::timestamptz IS NULL OR bucket_start < $3) \
          GROUP BY bucket \
          ORDER BY bucket DESC \
          LIMIT $2"
    );
    let rows: Vec<(OffsetDateTime, i64, i64, i64, i64, i64, i64, i64)> = sqlx::query_as(&sql)
        .bind(id)
        .bind(limit)
        .bind(before)
        .fetch_all(pool)
        .await?;
    // Returned newest-first; flip to chronological for the chart and fold the
    // Σsum / Σsamples into an average.
    let mut out: Vec<Candle> = rows
        .into_iter()
        .rev()
        .map(|(b, rx_hi, rx_lo, rx_sum, tx_hi, tx_lo, tx_sum, samples)| {
            let s = samples.max(1);
            Candle {
                bucket_start: b,
                rx_high: rx_hi,
                rx_low: rx_lo,
                rx_avg: rx_sum / s,
                tx_high: tx_hi,
                tx_low: tx_lo,
                tx_avg: tx_sum / s,
            }
        })
        .collect();
    out.shrink_to_fit();
    Ok(out)
}

pub async fn device_candles(
    pool: &PgPool,
    device_id: Uuid,
    tf: Timeframe,
    before: Option<OffsetDateTime>,
    limit: i64,
) -> sqlx::Result<Vec<Candle>> {
    query_candles(pool, Scope::Device, device_id, tf, before, limit).await
}

pub async fn server_candles(
    pool: &PgPool,
    server_id: Uuid,
    tf: Timeframe,
    before: Option<OffsetDateTime>,
    limit: i64,
) -> sqlx::Result<Vec<Candle>> {
    query_candles(pool, Scope::Server, server_id, tf, before, limit).await
}

/// Batch-insert completed 1-minute candles. Idempotent: a re-flushed minute
/// merges (max/min/Σ) rather than duplicating.
pub async fn insert_device_candles_1m(pool: &PgPool, rows: &[CandleRow]) -> sqlx::Result<u64> {
    insert_1m(pool, "bandwidth_candles_1m", "device_id", rows).await
}

pub async fn insert_server_candles_1m(pool: &PgPool, rows: &[CandleRow]) -> sqlx::Result<u64> {
    insert_1m(pool, "server_candles_1m", "server_id", rows).await
}

async fn insert_1m(
    pool: &PgPool,
    table: &str,
    id_col: &str,
    rows: &[CandleRow],
) -> sqlx::Result<u64> {
    if rows.is_empty() {
        return Ok(0);
    }
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let buckets: Vec<OffsetDateTime> = rows.iter().map(|r| r.bucket_start).collect();
    let rx_high: Vec<i64> = rows.iter().map(|r| r.rx_high).collect();
    let rx_low: Vec<i64> = rows.iter().map(|r| r.rx_low).collect();
    let rx_sum: Vec<i64> = rows.iter().map(|r| r.rx_sum).collect();
    let tx_high: Vec<i64> = rows.iter().map(|r| r.tx_high).collect();
    let tx_low: Vec<i64> = rows.iter().map(|r| r.tx_low).collect();
    let tx_sum: Vec<i64> = rows.iter().map(|r| r.tx_sum).collect();
    let samples: Vec<i32> = rows.iter().map(|r| r.samples).collect();
    let sql = format!(
        "INSERT INTO {table} ({id_col}, bucket_start, rx_high, rx_low, rx_sum, tx_high, tx_low, tx_sum, samples) \
         SELECT * FROM UNNEST($1::uuid[], $2::timestamptz[], $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[], $9::int[]) \
         ON CONFLICT ({id_col}, bucket_start) DO UPDATE SET \
           rx_high = GREATEST({table}.rx_high, EXCLUDED.rx_high), \
           rx_low  = LEAST({table}.rx_low, EXCLUDED.rx_low), \
           rx_sum  = {table}.rx_sum + EXCLUDED.rx_sum, \
           tx_high = GREATEST({table}.tx_high, EXCLUDED.tx_high), \
           tx_low  = LEAST({table}.tx_low, EXCLUDED.tx_low), \
           tx_sum  = {table}.tx_sum + EXCLUDED.tx_sum, \
           samples = {table}.samples + EXCLUDED.samples"
    );
    let res = sqlx::query(&sql)
        .bind(&ids)
        .bind(&buckets)
        .bind(&rx_high)
        .bind(&rx_low)
        .bind(&rx_sum)
        .bind(&tx_high)
        .bind(&tx_low)
        .bind(&tx_sum)
        .bind(&samples)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

/// Roll up one day's 1-minute candles into the daily table. Idempotent
/// (re-running overwrites the day). `day_start`/`day_end` bound the window.
pub async fn rollup_device_daily(
    pool: &PgPool,
    day_start: OffsetDateTime,
    day_end: OffsetDateTime,
) -> sqlx::Result<u64> {
    rollup_daily(
        pool,
        "bandwidth_candles_1d",
        "bandwidth_candles_1m",
        "device_id",
        day_start,
        day_end,
    )
    .await
}

pub async fn rollup_server_daily(
    pool: &PgPool,
    day_start: OffsetDateTime,
    day_end: OffsetDateTime,
) -> sqlx::Result<u64> {
    rollup_daily(
        pool,
        "server_candles_1d",
        "server_candles_1m",
        "server_id",
        day_start,
        day_end,
    )
    .await
}

async fn rollup_daily(
    pool: &PgPool,
    dst: &str,
    src: &str,
    id_col: &str,
    day_start: OffsetDateTime,
    day_end: OffsetDateTime,
) -> sqlx::Result<u64> {
    let sql = format!(
        "INSERT INTO {dst} ({id_col}, bucket_start, rx_high, rx_low, rx_sum, tx_high, tx_low, tx_sum, samples) \
         SELECT {id_col}, $1, MAX(rx_high), MIN(rx_low), SUM(rx_sum), MAX(tx_high), MIN(tx_low), SUM(tx_sum), SUM(samples) \
           FROM {src} \
          WHERE bucket_start >= $1 AND bucket_start < $2 \
          GROUP BY {id_col} \
         ON CONFLICT ({id_col}, bucket_start) DO UPDATE SET \
           rx_high = EXCLUDED.rx_high, rx_low = EXCLUDED.rx_low, rx_sum = EXCLUDED.rx_sum, \
           tx_high = EXCLUDED.tx_high, tx_low = EXCLUDED.tx_low, tx_sum = EXCLUDED.tx_sum, \
           samples = EXCLUDED.samples"
    );
    let res = sqlx::query(&sql)
        .bind(day_start)
        .bind(day_end)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

/// Delete candles older than the cutoffs. 1-minute candles are high-volume
/// (kept ~weeks); daily candles are tiny (kept ~years).
pub async fn prune(
    pool: &PgPool,
    minute_cutoff: OffsetDateTime,
    daily_cutoff: OffsetDateTime,
) -> sqlx::Result<u64> {
    let mut total = 0;
    for (table, cutoff) in [
        ("bandwidth_candles_1m", minute_cutoff),
        ("server_candles_1m", minute_cutoff),
        ("bandwidth_candles_1d", daily_cutoff),
        ("server_candles_1d", daily_cutoff),
    ] {
        let sql = format!("DELETE FROM {table} WHERE bucket_start < $1");
        total += sqlx::query(&sql).bind(cutoff).execute(pool).await?.rows_affected();
    }
    Ok(total)
}
