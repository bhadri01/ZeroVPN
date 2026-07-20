//! Per-session metadata behind the Security page's "Active sessions"
//! panel. See `migrations/00000000000033_user_sessions.sql` for the model:
//! tower-sessions owns the authoritative rows; this table adds the
//! user-queryable metadata. The auth extractor upserts on every
//! authenticated request (cheap PK upsert; the `last_seen_at` refresh is
//! throttled server-side to once a minute per session).

use ipnetwork::IpNetwork;
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::PgPool;

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct UserSessionRow {
    /// Surrogate id — safe to hand to the client (the tower session id is
    /// bearer-equivalent and never leaves the server).
    pub id: Uuid,
    #[schema(value_type = Option<String>)]
    pub ip: Option<IpNetwork>,
    pub user_agent: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen_at: OffsetDateTime,
}

/// Record (or refresh) the metadata row for a live session. The update arm
/// only rewrites `last_seen_at` when it is >60 s stale, so per-second
/// polling doesn't turn every request into a row write.
pub async fn upsert_seen(
    pool: &PgPool,
    session_id: &str,
    user_id: Uuid,
    ip: Option<IpNetwork>,
    user_agent: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO user_sessions (id, session_id, user_id, ip, user_agent)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id) DO UPDATE
              SET last_seen_at = NOW(), ip = EXCLUDED.ip
            WHERE user_sessions.last_seen_at < NOW() - INTERVAL '60 seconds'"#,
    )
    .bind(Uuid::now_v7())
    .bind(session_id)
    .bind(user_id)
    .bind(ip)
    .bind(user_agent)
    .execute(pool)
    .await?;
    Ok(())
}

/// Live sessions for a user, newest activity first. Joins the tower store
/// so rows whose session already expired or was revoked don't show.
pub async fn list_active_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> sqlx::Result<Vec<UserSessionRow>> {
    sqlx::query_as::<_, UserSessionRow>(
        r#"SELECT us.id, us.ip, us.user_agent, us.created_at, us.last_seen_at
             FROM user_sessions us
             JOIN tower_sessions.session s ON s.id = us.session_id
            WHERE us.user_id = $1
              AND s.expiry_date > NOW()
            ORDER BY us.last_seen_at DESC"#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// The surrogate id of the caller's own session row, so the client can
/// mark it "current" without ever seeing the tower id.
pub async fn surrogate_for_session(
    pool: &PgPool,
    session_id: &str,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar("SELECT id FROM user_sessions WHERE session_id = $1")
        .bind(session_id)
        .fetch_optional(pool)
        .await
}

/// Revoke one session by surrogate id, scoped to its owner: deletes the
/// authoritative tower row (the cookie dies instantly) and the metadata
/// row. Returns false when no such session belongs to this user.
pub async fn revoke_by_surrogate(
    pool: &PgPool,
    user_id: Uuid,
    surrogate: Uuid,
) -> sqlx::Result<bool> {
    let session_id: Option<String> = sqlx::query_scalar(
        "DELETE FROM user_sessions WHERE id = $1 AND user_id = $2 RETURNING session_id",
    )
    .bind(surrogate)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let Some(session_id) = session_id else {
        return Ok(false);
    };
    sqlx::query("DELETE FROM tower_sessions.session WHERE id = $1")
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(true)
}

/// Hard-delete every session for a user except the given one (the caller's
/// own). Complements the password-watermark bump in "sign out everywhere":
/// the watermark already makes the sessions unusable; this removes their
/// rows so the Active-sessions list agrees immediately.
pub async fn revoke_all_except(
    pool: &PgPool,
    user_id: Uuid,
    keep_session_id: &str,
) -> sqlx::Result<u64> {
    let res = sqlx::query(
        r#"WITH victims AS (
               DELETE FROM user_sessions
                WHERE user_id = $1 AND session_id <> $2
            RETURNING session_id
           )
           DELETE FROM tower_sessions.session s
            USING victims v WHERE s.id = v.session_id"#,
    )
    .bind(user_id)
    .bind(keep_session_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Retention sweep: drop metadata rows whose tower session is gone
/// (expired and vacuumed, logged out, or revoked elsewhere).
pub async fn purge_dangling(pool: &PgPool) -> sqlx::Result<u64> {
    let res = sqlx::query(
        r#"DELETE FROM user_sessions us
            WHERE NOT EXISTS (
                SELECT 1 FROM tower_sessions.session s
                 WHERE s.id = us.session_id AND s.expiry_date > NOW()
            )"#,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}
