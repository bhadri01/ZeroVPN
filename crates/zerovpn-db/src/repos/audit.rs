use ipnetwork::IpNetwork;
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::PgPool;

pub struct AuditEntry<'a> {
    pub actor_user_id: Option<Uuid>,
    pub action: &'a str,
    pub target_type: Option<&'a str>,
    pub target_id: Option<Uuid>,
    pub metadata: Value,
    pub ip_prefix: Option<IpNetwork>,
}

pub async fn record(pool: &PgPool, e: AuditEntry<'_>) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, ip_prefix)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(e.actor_user_id)
    .bind(e.action)
    .bind(e.target_type)
    .bind(e.target_id)
    .bind(e.metadata)
    .bind(e.ip_prefix)
    .execute(pool)
    .await?;
    Ok(())
}

/// Row returned by `list_for_target`. Just the columns the device
/// timeline UI needs — ip_prefix and target_type are stripped because
/// the caller already filtered on them.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TimelineEntry {
    pub id: i64,
    pub action: String,
    pub metadata: Value,
    pub created_at: OffsetDateTime,
}

/// Fetch the most recent audit entries for a specific target (e.g. a
/// device). The caller is responsible for verifying that the calling
/// user owns the target before invoking this — the function does not
/// check authorisation on its own. Newest first; `limit` is hard-capped
/// at 500 to keep the response payload bounded.
pub async fn list_for_target(
    pool: &PgPool,
    target_type: &str,
    target_id: Uuid,
    limit: i64,
) -> sqlx::Result<Vec<TimelineEntry>> {
    let limit = limit.clamp(1, 500);
    sqlx::query_as::<_, TimelineEntry>(
        r#"SELECT id, action, metadata, created_at
             FROM audit_logs
            WHERE target_type = $1 AND target_id = $2
            ORDER BY created_at DESC, id DESC
            LIMIT $3"#,
    )
    .bind(target_type)
    .bind(target_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}
