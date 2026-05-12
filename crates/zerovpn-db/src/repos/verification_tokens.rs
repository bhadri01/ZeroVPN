use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::PgPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "token_purpose", rename_all = "snake_case")]
pub enum TokenPurpose {
    EmailVerify,
    PasswordReset,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct VerificationToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub purpose: TokenPurpose,
    pub expires_at: OffsetDateTime,
    pub consumed_at: Option<OffsetDateTime>,
}

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    purpose: TokenPurpose,
    token_hash: &str,
    ttl: time::Duration,
) -> sqlx::Result<Uuid> {
    let id = Uuid::now_v7();
    let expires_at = OffsetDateTime::now_utc() + ttl;
    sqlx::query(
        r#"INSERT INTO verification_tokens
              (id, user_id, purpose, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(id)
    .bind(user_id)
    .bind(purpose)
    .bind(token_hash)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn find_active(pool: &PgPool, token_hash: &str) -> sqlx::Result<Option<VerificationToken>> {
    sqlx::query_as::<_, VerificationToken>(
        r#"SELECT id, user_id, purpose, expires_at, consumed_at
             FROM verification_tokens
            WHERE token_hash = $1
              AND consumed_at IS NULL
              AND expires_at > NOW()"#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await
}

/// Look up a token by hash regardless of expiry/consumed state. Used by the
/// pre-flight verify endpoint so the frontend can tell the user *why* a
/// link doesn't work (used vs. expired vs. unknown), rather than collapsing
/// all three into "expired".
pub async fn find_by_hash(pool: &PgPool, token_hash: &str) -> sqlx::Result<Option<VerificationToken>> {
    sqlx::query_as::<_, VerificationToken>(
        r#"SELECT id, user_id, purpose, expires_at, consumed_at
             FROM verification_tokens
            WHERE token_hash = $1"#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await
}

pub async fn consume(pool: &PgPool, id: Uuid) -> sqlx::Result<u64> {
    let res = sqlx::query("UPDATE verification_tokens SET consumed_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

/// Count tokens of `purpose` issued for `user_id` in the last `seconds`.
/// Used by the resend-verify endpoint to throttle email blasts without
/// touching a separate rate-limit table — we already write a row every
/// time `issue_verify_email` runs.
pub async fn count_recent_for_user(
    pool: &PgPool,
    user_id: Uuid,
    purpose: TokenPurpose,
    seconds: i64,
) -> sqlx::Result<i64> {
    let cutoff = OffsetDateTime::now_utc() - time::Duration::seconds(seconds);
    let row: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM verification_tokens
           WHERE user_id = $1 AND purpose = $2 AND created_at > $3"#,
    )
    .bind(user_id)
    .bind(purpose)
    .bind(cutoff)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

/// Invalidate any active tokens for the same purpose so a user can only
/// have one outstanding password-reset / email-verify token at a time.
pub async fn invalidate_active(
    pool: &PgPool,
    user_id: Uuid,
    purpose: TokenPurpose,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE verification_tokens
              SET consumed_at = NOW()
            WHERE user_id = $1
              AND purpose = $2
              AND consumed_at IS NULL"#,
    )
    .bind(user_id)
    .bind(purpose)
    .execute(pool)
    .await?;
    Ok(())
}
