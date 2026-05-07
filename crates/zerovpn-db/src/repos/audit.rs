use ipnetwork::IpNetwork;
use serde_json::Value;
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
