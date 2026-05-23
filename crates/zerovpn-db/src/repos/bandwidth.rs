use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::PgPool;

/// Persist a single delta sample for one device. Deltas are stored,
/// not cumulative counters.
pub async fn insert_sample(
    pool: &PgPool,
    device_id: Uuid,
    sampled_at: OffsetDateTime,
    rx_bytes: i64,
    tx_bytes: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO bandwidth_samples (device_id, sampled_at, rx_bytes, tx_bytes)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (device_id, sampled_at) DO NOTHING"#,
    )
    .bind(device_id)
    .bind(sampled_at)
    .bind(rx_bytes)
    .bind(tx_bytes)
    .execute(pool)
    .await?;
    Ok(())
}

/// Run an upsert pass that rolls up the closed previous hour into hourly
/// aggregates. Idempotent: re-running with the same window updates the
/// existing row to the latest computed values.
pub async fn rollup_hourly(pool: &PgPool, hour_start: OffsetDateTime) -> sqlx::Result<u64> {
    let hour_end = hour_start + time::Duration::hours(1);
    let res = sqlx::query(
        r#"INSERT INTO bandwidth_aggregates
              (device_id, user_id, bucket, bucket_start, rx_bytes, tx_bytes, sample_count)
           SELECT s.device_id,
                  d.user_id,
                  'hour'::bucket_kind,
                  $1,
                  COALESCE(SUM(s.rx_bytes), 0)::BIGINT,
                  COALESCE(SUM(s.tx_bytes), 0)::BIGINT,
                  COUNT(*)::INT
             FROM bandwidth_samples s
             JOIN devices d ON d.id = s.device_id
            WHERE s.sampled_at >= $1 AND s.sampled_at < $2
            GROUP BY s.device_id, d.user_id
           ON CONFLICT (device_id, bucket, bucket_start) DO UPDATE
             SET rx_bytes = EXCLUDED.rx_bytes,
                 tx_bytes = EXCLUDED.tx_bytes,
                 sample_count = EXCLUDED.sample_count"#,
    )
    .bind(hour_start)
    .bind(hour_end)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Roll up a closed day from its 24 hourly buckets.
pub async fn rollup_daily(pool: &PgPool, day_start: OffsetDateTime) -> sqlx::Result<u64> {
    let day_end = day_start + time::Duration::days(1);
    let res = sqlx::query(
        r#"INSERT INTO bandwidth_aggregates
              (device_id, user_id, bucket, bucket_start, rx_bytes, tx_bytes, sample_count)
           SELECT device_id,
                  user_id,
                  'day'::bucket_kind,
                  $1,
                  COALESCE(SUM(rx_bytes), 0)::BIGINT,
                  COALESCE(SUM(tx_bytes), 0)::BIGINT,
                  COALESCE(SUM(sample_count), 0)::INT
             FROM bandwidth_aggregates
            WHERE bucket = 'hour' AND bucket_start >= $1 AND bucket_start < $2
            GROUP BY device_id, user_id
           ON CONFLICT (device_id, bucket, bucket_start) DO UPDATE
             SET rx_bytes = EXCLUDED.rx_bytes,
                 tx_bytes = EXCLUDED.tx_bytes,
                 sample_count = EXCLUDED.sample_count"#,
    )
    .bind(day_start)
    .bind(day_end)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct BandwidthBucket {
    pub bucket_start: OffsetDateTime,
    pub rx_bytes: i64,
    pub tx_bytes: i64,
}

/// Hourly history for a single device in the last `hours` hours.
/// Includes hours with no data as a zero-bucket on the API side
/// (we don't synthesize them in SQL — let the frontend interpolate).
pub async fn device_hourly(
    pool: &PgPool,
    device_id: Uuid,
    hours: i64,
) -> sqlx::Result<Vec<BandwidthBucket>> {
    let since = OffsetDateTime::now_utc() - time::Duration::hours(hours);
    sqlx::query_as::<_, BandwidthBucket>(
        r#"SELECT bucket_start, rx_bytes, tx_bytes
             FROM bandwidth_aggregates
            WHERE device_id = $1 AND bucket = 'hour' AND bucket_start >= $2
            ORDER BY bucket_start ASC"#,
    )
    .bind(device_id)
    .bind(since)
    .fetch_all(pool)
    .await
}

/// Daily history for a single device.
pub async fn device_daily(
    pool: &PgPool,
    device_id: Uuid,
    days: i64,
) -> sqlx::Result<Vec<BandwidthBucket>> {
    let since = OffsetDateTime::now_utc() - time::Duration::days(days);
    sqlx::query_as::<_, BandwidthBucket>(
        r#"SELECT bucket_start, rx_bytes, tx_bytes
             FROM bandwidth_aggregates
            WHERE device_id = $1 AND bucket = 'day' AND bucket_start >= $2
            ORDER BY bucket_start ASC"#,
    )
    .bind(device_id)
    .bind(since)
    .fetch_all(pool)
    .await
}

/// Raw (un-rolled-up) samples for a device. The samples table is
/// tick-cadence (1s default) so the caller must bound the window — an
/// unbounded query against a tick table is slow on a busy host.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RawSample {
    pub sampled_at: OffsetDateTime,
    pub rx_bytes: i64,
    pub tx_bytes: i64,
}

pub async fn device_raw(
    pool: &PgPool,
    device_id: Uuid,
    from: OffsetDateTime,
    to: OffsetDateTime,
    limit: i64,
) -> sqlx::Result<Vec<RawSample>> {
    sqlx::query_as::<_, RawSample>(
        r#"SELECT sampled_at, rx_bytes, tx_bytes
             FROM bandwidth_samples
            WHERE device_id = $1 AND sampled_at >= $2 AND sampled_at < $3
            ORDER BY sampled_at ASC
            LIMIT $4"#,
    )
    .bind(device_id)
    .bind(from)
    .bind(to)
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Fleet-wide all-time RX/TX totals, summed across every device every
/// user owns. Powers the admin overview "Fleet bandwidth" card.
///
/// We sum the `'hour'` rollups specifically — the table also holds `'day'`
/// rows derived from the same hours, so a bucket-agnostic SUM would
/// double-count. Returns a single (rx_bytes, tx_bytes) tuple.
pub async fn fleet_totals(pool: &PgPool) -> sqlx::Result<(i64, i64)> {
    let row: (i64, i64) = sqlx::query_as(
        r#"SELECT COALESCE(SUM(rx_bytes), 0)::BIGINT,
                  COALESCE(SUM(tx_bytes), 0)::BIGINT
             FROM bandwidth_aggregates
            WHERE bucket = 'hour'::bucket_kind"#,
    )
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// All-time RX/TX totals per device for a user, keyed by `device_id`.
/// Sums the `'hour'` rollups specifically — the table also holds `'day'`
/// rows derived from the same hours, so a bucket-agnostic SUM would
/// double-count (see [`fleet_totals`]). Devices with no traffic yet simply
/// don't appear in the result. Powers the persisted RX/TX TOTAL on the
/// device cards (survives reloads, unlike the session-local live counters).
pub async fn device_totals(
    pool: &PgPool,
    user_id: Uuid,
) -> sqlx::Result<Vec<(Uuid, i64, i64)>> {
    sqlx::query_as(
        r#"SELECT device_id,
                  COALESCE(SUM(rx_bytes), 0)::BIGINT,
                  COALESCE(SUM(tx_bytes), 0)::BIGINT
             FROM bandwidth_aggregates
            WHERE user_id = $1 AND bucket = 'hour'::bucket_kind
            GROUP BY device_id"#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// Total aggregated for a user across all devices in a date range.
pub async fn user_totals(
    pool: &PgPool,
    user_id: Uuid,
    since: OffsetDateTime,
    bucket: &str,
) -> sqlx::Result<Vec<BandwidthBucket>> {
    sqlx::query_as::<_, BandwidthBucket>(
        r#"SELECT bucket_start,
                  COALESCE(SUM(rx_bytes), 0)::BIGINT AS rx_bytes,
                  COALESCE(SUM(tx_bytes), 0)::BIGINT AS tx_bytes
             FROM bandwidth_aggregates
            WHERE user_id = $1 AND bucket = $2::bucket_kind AND bucket_start >= $3
            GROUP BY bucket_start
            ORDER BY bucket_start ASC"#,
    )
    .bind(user_id)
    .bind(bucket)
    .bind(since)
    .fetch_all(pool)
    .await
}

/// Total aggregated for a server across every device hosted on it.
/// `bandwidth_aggregates` is keyed on `device_id`, so we join through
/// `devices` to filter by `server_id`. Same bucketing behaviour as
/// `user_totals`.
pub async fn server_totals(
    pool: &PgPool,
    server_id: Uuid,
    since: OffsetDateTime,
    bucket: &str,
) -> sqlx::Result<Vec<BandwidthBucket>> {
    sqlx::query_as::<_, BandwidthBucket>(
        r#"SELECT a.bucket_start,
                  COALESCE(SUM(a.rx_bytes), 0)::BIGINT AS rx_bytes,
                  COALESCE(SUM(a.tx_bytes), 0)::BIGINT AS tx_bytes
             FROM bandwidth_aggregates a
             JOIN devices d ON d.id = a.device_id
            WHERE d.server_id = $1
              AND a.bucket = $2::bucket_kind
              AND a.bucket_start >= $3
            GROUP BY a.bucket_start
            ORDER BY a.bucket_start ASC"#,
    )
    .bind(server_id)
    .bind(bucket)
    .bind(since)
    .fetch_all(pool)
    .await
}
