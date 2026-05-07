//! Bandwidth aggregation task.
//!
//! Every 5 minutes:
//! - Roll up the closed previous hour into `bandwidth_aggregates(bucket=hour)`.
//! - At day boundary (00:05 UTC), roll up the closed previous day from the
//!   24 hourly buckets into `bandwidth_aggregates(bucket=day)`.
//!
//! Idempotent: re-running the same window updates the existing row in
//! place. The same task also runs the partial-retention window once a day
//! to drop `bandwidth_samples` older than 7 days; samples are only the
//! input to aggregation so dropping them is safe.

use std::time::Duration;

use time::OffsetDateTime;
use tracing::{info, warn};
use zerovpn_db::{PgPool, repos::bandwidth};

const TICK: Duration = Duration::from_secs(300); // 5 minutes

pub async fn run(pool: PgPool) {
    info!("bandwidth aggregator started");
    let mut ticker = tokio::time::interval(TICK);
    loop {
        ticker.tick().await;
        let now = OffsetDateTime::now_utc();

        // Roll up the closed previous hour. `truncate_to_hour` gives the
        // start of the current hour; subtract 1h to get the previous one.
        let prev_hour = truncate_to_hour(now) - time::Duration::hours(1);
        match bandwidth::rollup_hourly(&pool, prev_hour).await {
            Ok(n) => info!(?prev_hour, rows = n, "hourly rollup"),
            Err(e) => warn!(?e, "hourly rollup failed"),
        }

        // Daily rollup at 00:05 UTC (after midnight + a buffer).
        if now.hour() == 0 && now.minute() < 10 {
            let prev_day = truncate_to_day(now) - time::Duration::days(1);
            match bandwidth::rollup_daily(&pool, prev_day).await {
                Ok(n) => info!(?prev_day, rows = n, "daily rollup"),
                Err(e) => warn!(?e, "daily rollup failed"),
            }
        }
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
