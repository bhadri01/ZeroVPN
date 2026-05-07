//! Retention enforcement.
//!
//! Runs every 6 hours. Drops bandwidth_samples partitions older than the
//! retention window, expires consumed verification tokens, anonymizes
//! old audit-log IP prefixes, and hard-purges users that have been
//! soft-deleted for >30 days.

use std::time::Duration;

use time::OffsetDateTime;
use tracing::{info, warn};
use zerovpn_db::PgPool;

const TICK: Duration = Duration::from_secs(6 * 3600);
const SAMPLE_RETENTION_DAYS: i64 = 7;
const VERIFY_TOKEN_RETENTION_HOURS: i64 = 24;
const SOFT_DELETE_PURGE_DAYS: i64 = 30;

pub async fn run(pool: PgPool) {
    info!("retention purger started");
    // Run once on startup for fast feedback in dev.
    if let Err(e) = run_once(&pool).await {
        warn!(?e, "retention pass failed");
    }
    let mut ticker = tokio::time::interval(TICK);
    ticker.tick().await; // skip immediate
    loop {
        ticker.tick().await;
        if let Err(e) = run_once(&pool).await {
            warn!(?e, "retention pass failed");
        }
    }
}

async fn run_once(pool: &PgPool) -> sqlx::Result<()> {
    let now = OffsetDateTime::now_utc();

    // 1. Drop bandwidth_samples rows older than 7d. (Partitions could be
    //    DROPped instead, but that requires knowing the partition name;
    //    for v1 a row-level DELETE on the parent table is fine and the
    //    aggregator has already rolled them up.)
    let cutoff = now - time::Duration::days(SAMPLE_RETENTION_DAYS);
    let res = sqlx::query("DELETE FROM bandwidth_samples WHERE sampled_at < $1")
        .bind(cutoff)
        .execute(pool)
        .await?;
    if res.rows_affected() > 0 {
        info!(rows = res.rows_affected(), "purged old bandwidth samples");
    }

    // 2. Expire consumed/expired verification tokens that are older than
    //    24h — they no longer serve any purpose.
    let token_cutoff = now - time::Duration::hours(VERIFY_TOKEN_RETENTION_HOURS);
    let res = sqlx::query(
        "DELETE FROM verification_tokens
          WHERE (consumed_at IS NOT NULL OR expires_at < $1)
            AND created_at < $1",
    )
    .bind(token_cutoff)
    .execute(pool)
    .await?;
    if res.rows_affected() > 0 {
        info!(rows = res.rows_affected(), "purged stale verification tokens");
    }

    // 3. Anonymize audit-log IP prefixes after 30 days. The IP prefix is
    //    already /24, but we drop it entirely once the security signal is
    //    no longer useful.
    let audit_cutoff = now - time::Duration::days(30);
    let res = sqlx::query(
        "UPDATE audit_logs SET ip_prefix = NULL WHERE created_at < $1 AND ip_prefix IS NOT NULL",
    )
    .bind(audit_cutoff)
    .execute(pool)
    .await?;
    if res.rows_affected() > 0 {
        info!(rows = res.rows_affected(), "anonymized audit IPs");
    }

    // 4. Hard-purge users soft-deleted >30 days ago. Cascades remove
    //    devices, sessions, api_tokens, etc.
    let purge_cutoff = now - time::Duration::days(SOFT_DELETE_PURGE_DAYS);
    let res = sqlx::query(
        "DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < $1",
    )
    .bind(purge_cutoff)
    .execute(pool)
    .await?;
    if res.rows_affected() > 0 {
        info!(rows = res.rows_affected(), "hard-purged soft-deleted users");
    }

    // 5. Expire failed_logins older than 30 days.
    let res = sqlx::query("DELETE FROM failed_logins WHERE attempted_at < $1")
        .bind(audit_cutoff)
        .execute(pool)
        .await?;
    if res.rows_affected() > 0 {
        info!(rows = res.rows_affected(), "purged old failed_logins");
    }

    Ok(())
}
