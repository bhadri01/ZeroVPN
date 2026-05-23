//! Retention enforcement.
//!
//! Runs every 6 hours (and once on startup for fast dev feedback).
//!
//! **Account-lifecycle cleanup** — rows that are pure overhead once their
//! TTL has passed:
//! - Verification tokens older than 24 h (consumed or expired) — the email
//!   link is dead, the row is just bytes.
//! - Soft-deleted users older than 30 d — cascade-removes their devices,
//!   sessions, api_tokens, etc., reclaiming storage.
//! - Pending-verification accounts older than 7 d — the verify-email link
//!   expired at 24 h and the row only blocks the email from re-registering.
//!
//! **Operational-data TTLs** — high-volume tables are purged past a fixed
//! window so they don't grow without bound:
//! - `bandwidth_samples` (raw 1 s ticks)  — 30 d
//! - `server_samples`    (host metrics)   — 30 d
//! - `destination_ips`   (flow ingest)    — 30 d
//! - `audit_logs`        (audit trail)    — 30 d
//! - `failed_logins`     (auth failures)  — 30 d
//!
//! `bandwidth_aggregates` (hour/day rollups) is intentionally kept: it's
//! the long-term history the dashboards read and is tiny next to the raw
//! samples it's derived from.
//!
//! Windows are hardcoded constants below. `bandwidth_samples` and
//! `server_samples` are RANGE-partitioned on `sampled_at`; a plain DELETE
//! is correct but leaves empty partitions behind — dropping whole expired
//! partitions would be cheaper and is a natural follow-up (along with
//! making the windows operator-tunable via env, the deferred Stage-D work).

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

const SAMPLE_RETENTION_DAYS: i64 = 30;
const SERVER_SAMPLE_RETENTION_DAYS: i64 = 30;
const DEST_RETENTION_DAYS: i64 = 30;
const AUDIT_RETENTION_DAYS: i64 = 30;
const FAILED_LOGIN_RETENTION_DAYS: i64 = 30;

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

    // --- Account-lifecycle cleanup -------------------------------------

    // Expire consumed/expired verification tokens older than 24 h — they
    // no longer serve any purpose.
    purge(
        pool,
        "purged stale verification tokens",
        "DELETE FROM verification_tokens
          WHERE (consumed_at IS NOT NULL OR expires_at < $1)
            AND created_at < $1",
        now - time::Duration::hours(VERIFY_TOKEN_RETENTION_HOURS),
    )
    .await?;

    // Hard-purge users soft-deleted >30 days ago. Cascades remove devices,
    // sessions, api_tokens, etc.
    purge(
        pool,
        "hard-purged soft-deleted users",
        "DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < $1",
        now - time::Duration::days(SOFT_DELETE_PURGE_DAYS),
    )
    .await?;

    // Drop accounts that signed up but never clicked the verify link. Once
    // the verify token has been dead for days the row just blocks the email
    // from being re-registered. Cascades clean up leftover tokens.
    purge(
        pool,
        "purged stale pending-verification accounts",
        "DELETE FROM users
          WHERE status = 'pending_verification'
            AND email_verified_at IS NULL
            AND created_at < $1",
        now - time::Duration::days(PENDING_VERIFICATION_PURGE_DAYS),
    )
    .await?;

    // --- Operational-data TTLs -----------------------------------------

    // Raw bandwidth ticks. Safe to drop past the window because the hourly/
    // daily rollups in `bandwidth_aggregates` already preserve the history
    // the dashboards read.
    purge(
        pool,
        "purged expired bandwidth samples",
        "DELETE FROM bandwidth_samples WHERE sampled_at < $1",
        now - time::Duration::days(SAMPLE_RETENTION_DAYS),
    )
    .await?;

    // Host CPU/mem/net/disk samples.
    purge(
        pool,
        "purged expired server samples",
        "DELETE FROM server_samples WHERE sampled_at < $1",
        now - time::Duration::days(SERVER_SAMPLE_RETENTION_DAYS),
    )
    .await?;

    // Flow-log destination records (keyed on flow start time).
    purge(
        pool,
        "purged expired destination IPs",
        "DELETE FROM destination_ips WHERE started_at < $1",
        now - time::Duration::days(DEST_RETENTION_DAYS),
    )
    .await?;

    // Audit trail.
    purge(
        pool,
        "purged expired audit logs",
        "DELETE FROM audit_logs WHERE created_at < $1",
        now - time::Duration::days(AUDIT_RETENTION_DAYS),
    )
    .await?;

    // Failed-login records.
    purge(
        pool,
        "purged expired failed logins",
        "DELETE FROM failed_logins WHERE attempted_at < $1",
        now - time::Duration::days(FAILED_LOGIN_RETENTION_DAYS),
    )
    .await?;

    Ok(())
}

/// Run a single-parameter DELETE bound to `cutoff` and log how many rows it
/// removed (only when non-zero, to keep idle passes quiet). The SQL may
/// reference `$1` more than once; it is bound a single time.
async fn purge(
    pool: &PgPool,
    label: &'static str,
    sql: &str,
    cutoff: OffsetDateTime,
) -> sqlx::Result<()> {
    let res = sqlx::query(sql).bind(cutoff).execute(pool).await?;
    if res.rows_affected() > 0 {
        info!(rows = res.rows_affected(), "{}", label);
    }
    Ok(())
}
