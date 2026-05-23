//! Bandwidth aggregation task.
//!
//! Every minute:
//! - Roll up the **current** (in-progress) hour into
//!   `bandwidth_aggregates(bucket=hour)` so the dashboard chart shows
//!   live activity instead of waiting for the hour to close.
//! - Roll up the closed **previous** hour too — covers the case where a
//!   tick straddles the hour boundary.
//! - Roll up the current day (so today appears in the 30d view) and the
//!   previous day (covers the midnight straddle in the same way).
//!
//! Idempotent: every `rollup_*` is `INSERT ... ON CONFLICT DO UPDATE`,
//! so re-running the same window just overwrites the bucket with the
//! latest sum. This task only *writes* the aggregates; pruning the raw
//! `bandwidth_samples` past their TTL is the retention task's job (see
//! `retention.rs`).
//!
//! Startup also runs a rollup immediately rather than waiting one full
//! interval — important for dev where the worker is restarted often.

use std::time::Duration;

use time::OffsetDateTime;
use tracing::{info, warn};
use zerovpn_db::{PgPool, repos::bandwidth};

/// 1-minute cadence. Each tick re-rolls the current hour (idempotently),
/// so the dashboard never trails by more than a minute.
const TICK: Duration = Duration::from_secs(60);

pub async fn run(pool: PgPool) {
    info!("bandwidth aggregator started");
    // First pass before the ticker so a freshly-started worker doesn't
    // leave the dashboard chart empty for the first interval.
    run_once(&pool).await;

    let mut ticker = tokio::time::interval(TICK);
    ticker.tick().await; // skip the immediate tick the interval emits
    loop {
        ticker.tick().await;
        run_once(&pool).await;
    }
}

async fn run_once(pool: &PgPool) {
    let now = OffsetDateTime::now_utc();
    let cur_hour = truncate_to_hour(now);
    let prev_hour = cur_hour - time::Duration::hours(1);

    // Current hour — partial bucket gets overwritten with the running
    // total on every tick. Without this the dashboard chart shows
    // "No data yet" until the user crosses the next hour boundary.
    match bandwidth::rollup_hourly(pool, cur_hour).await {
        Ok(n) => info!(?cur_hour, rows = n, "current-hour rollup"),
        Err(e) => warn!(?e, "current-hour rollup failed"),
    }
    // Previous hour — covers the case where the tick lands a few seconds
    // after the hour boundary and we haven't yet finalized the closing
    // row. Cheap because there's only one of these per device per hour.
    match bandwidth::rollup_hourly(pool, prev_hour).await {
        Ok(n) => info!(?prev_hour, rows = n, "previous-hour rollup"),
        Err(e) => warn!(?e, "previous-hour rollup failed"),
    }

    // Same idea at day granularity. We roll the daily bucket from the
    // hour rows we just refreshed, so today's RX/TX appears in the 30d
    // view without waiting for midnight.
    let cur_day = truncate_to_day(now);
    let prev_day = cur_day - time::Duration::days(1);
    match bandwidth::rollup_daily(pool, cur_day).await {
        Ok(n) => info!(?cur_day, rows = n, "current-day rollup"),
        Err(e) => warn!(?e, "current-day rollup failed"),
    }
    match bandwidth::rollup_daily(pool, prev_day).await {
        Ok(n) => info!(?prev_day, rows = n, "previous-day rollup"),
        Err(e) => warn!(?e, "previous-day rollup failed"),
    }
}

fn truncate_to_hour(t: OffsetDateTime) -> OffsetDateTime {
    let h = t.hour();
    let date = t.date();
    OffsetDateTime::new_utc(
        date,
        time::Time::from_hms(h, 0, 0).expect("valid h"),
    )
}

fn truncate_to_day(t: OffsetDateTime) -> OffsetDateTime {
    OffsetDateTime::new_utc(t.date(), time::Time::MIDNIGHT)
}
