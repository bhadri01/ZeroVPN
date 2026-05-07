use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::PgPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "api_token_scope", rename_all = "snake_case")]
pub enum ApiTokenScope {
    Read,
    ReadWrite,
    Admin,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ApiTokenRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub scope: ApiTokenScope,
    pub last_used_at: Option<OffsetDateTime>,
    pub expires_at: Option<OffsetDateTime>,
    pub revoked_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    token_hash: &str,
    scope: ApiTokenScope,
    expires_at: Option<OffsetDateTime>,
) -> sqlx::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO api_tokens (id, user_id, name, token_hash, scope, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(id)
    .bind(user_id)
    .bind(name)
    .bind(token_hash)
    .bind(scope)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<ApiTokenRow>> {
    sqlx::query_as::<_, ApiTokenRow>(
        r#"SELECT id, user_id, name, scope, last_used_at, expires_at, revoked_at, created_at
             FROM api_tokens
            WHERE user_id = $1
            ORDER BY created_at DESC"#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn revoke(pool: &PgPool, user_id: Uuid, id: Uuid) -> sqlx::Result<u64> {
    let res = sqlx::query(
        r#"UPDATE api_tokens
              SET revoked_at = NOW()
            WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL"#,
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Find the user owning a token and bump `last_used_at`. Used by the API-token
/// auth middleware. Returns `(user_id, scope)` if the token is valid + active.
pub async fn find_active_by_hash(
    pool: &PgPool,
    token_hash: &str,
    ip_prefix: Option<IpNetwork>,
) -> sqlx::Result<Option<(Uuid, ApiTokenScope)>> {
    let row: Option<(Uuid, Uuid, ApiTokenScope)> = sqlx::query_as(
        r#"SELECT id, user_id, scope FROM api_tokens
            WHERE token_hash = $1
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > NOW())"#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?;
    if let Some((id, user_id, scope)) = row {
        sqlx::query("UPDATE api_tokens SET last_used_at = NOW(), last_used_ip_prefix = $2 WHERE id = $1")
            .bind(id)
            .bind(ip_prefix)
            .execute(pool)
            .await?;
        Ok(Some((user_id, scope)))
    } else {
        Ok(None)
    }
}
