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
const VERIFY_TOKEN_RETENTION_HOURS: i64 = 24;
const SOFT_DELETE_PURGE_DAYS: i64 = 30;
/// Pending-verification accounts older than this are dropped outright.
/// Their verify-email TTL is 24 h, so by day 7 the link is long-dead and
/// the row is just blocking the email from being re-registered.
const PENDING_VERIFICATION_PURGE_DAYS: i64 = 7;

/// Retention window for raw `bandwidth_samples` (per-tick rows). Read from
/// `ZEROVPN_SAMPLE_RETENTION_DAYS`. **Unset (None) → samples are never
/// purged.** This is the "trading-style every-tick" default; set a value
/// (e.g. `30`) to bring back a hard window if disk growth becomes a
/// problem. See docs/runbook.md → "Sample retention".
fn sample_retention_days() -> Option<i64> {
    std::env::var("ZEROVPN_SAMPLE_RETENTION_DAYS")
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|d| *d > 0)
}

/// Same as `sample_retention_days` but for `server_samples`. Independent
/// knob so operators can keep aggregate-shaped server history longer than
/// per-device samples if they want.
fn server_sample_retention_days() -> Option<i64> {
    std::env::var("ZEROVPN_SERVER_SAMPLE_RETENTION_DAYS")
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|d| *d > 0)
}

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

    // 1. Drop bandwidth_samples rows older than the configured window.
    //    Default (env var unset): keep forever — see sample_retention_days.
    //    Aggregates are unaffected, so the long-term hour/day/month charts
    //    continue to work regardless of this window.
    if let Some(days) = sample_retention_days() {
        let cutoff = now - time::Duration::days(days);
        let res = sqlx::query("DELETE FROM bandwidth_samples WHERE sampled_at < $1")
            .bind(cutoff)
            .execute(pool)
            .await?;
        if res.rows_affected() > 0 {
            info!(
                rows = res.rows_affected(),
                days, "purged old bandwidth samples"
            );
        }
    }

    // 1b. Same for server_samples. Independent knob.
    if let Some(days) = server_sample_retention_days() {
        let cutoff = now - time::Duration::days(days);
        let res = sqlx::query("DELETE FROM server_samples WHERE sampled_at < $1")
            .bind(cutoff)
            .execute(pool)
            .await?;
        if res.rows_affected() > 0 {
            info!(
                rows = res.rows_affected(),
                days, "purged old server samples"
            );
        }
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

    // 6. Drop accounts that signed up but never clicked the verify link.
    //    Once the verify token has been dead for days, the row just blocks
    //    the email from being re-registered. Cascades clean up any
    //    leftover verification_tokens.
    let pending_cutoff = now - time::Duration::days(PENDING_VERIFICATION_PURGE_DAYS);
    let res = sqlx::query(
        "DELETE FROM users
          WHERE status = 'pending_verification'
            AND email_verified_at IS NULL
            AND created_at < $1",
    )
    .bind(pending_cutoff)
    .execute(pool)
    .await?;
    if res.rows_affected() > 0 {
        info!(
            rows = res.rows_affected(),
            "purged stale pending-verification accounts"
        );
    }

    Ok(())
}
