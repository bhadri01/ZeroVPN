use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

use crate::PgPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "failed_login_reason", rename_all = "snake_case")]
pub enum FailedLoginReason {
    WrongPassword,
    UnknownEmail,
    TotpFailed,
    AccountSuspended,
    AccountPendingVerification,
    RateLimited,
}

/// Record a failed-login attempt. The `ip` parameter takes the **full**
/// client address (Phase 2 / Stage A — no more /24 truncation). The
/// column type is `INET`, accepting `/32` (v4) or `/128` (v6) host
/// networks. Renamed from `ip_prefix` in migration 20.
/// The `user_agent` parameter stores the raw `User-Agent` header in
/// plaintext (no more SHA-256 hashing).
pub async fn record(
    pool: &PgPool,
    email: Option<&str>,
    ip: Option<IpNetwork>,
    user_agent: Option<&str>,
    reason: FailedLoginReason,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO failed_logins (email_attempted, ip, user_agent, reason)
           VALUES ($1::CITEXT, $2, $3, $4)"#,
    )
    .bind(email)
    .bind(ip)
    .bind(user_agent)
    .bind(reason)
    .execute(pool)
    .await?;
    Ok(())
}

/// Count failed logins for a given email in the last `seconds`.
pub async fn recent_for_email(pool: &PgPool, email: &str, seconds: i64) -> sqlx::Result<i64> {
    let cutoff = OffsetDateTime::now_utc() - time::Duration::seconds(seconds);
    let row: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM failed_logins
           WHERE email_attempted = $1::CITEXT AND attempted_at > $2"#,
    )
    .bind(email)
    .bind(cutoff)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}
