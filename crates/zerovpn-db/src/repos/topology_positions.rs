//! Per-user saved topology positions. Backs the live-topology drag UI.
//!
//! Storage: one row per (user_id, node_id) — node_id is either a device
//! UUID string or the literal "__hub__". Bulk replace on save (caller sends
//! the full map every PUT).

use uuid::Uuid;

use crate::PgPool;

#[derive(Debug, Clone)]
pub struct Position {
    pub node_id: String,
    pub x: f64,
    pub y: f64,
}

/// Return every position the user has saved. Empty vec if they've never
/// dragged a node.
pub async fn get_all(pool: &PgPool, user_id: Uuid) -> sqlx::Result<Vec<Position>> {
    let rows: Vec<(String, f64, f64)> = sqlx::query_as(
        "SELECT node_id, x, y FROM topology_positions WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(node_id, x, y)| Position { node_id, x, y })
        .collect())
}

/// Bulk-replace the user's positions inside a single transaction: delete
/// every existing row then insert the new set. Atomic — a partial failure
/// rolls back so the user's saved layout is never half-applied.
///
/// `positions` of length 0 effectively clears the user's saved layout (the
/// frontend hits this on Reset).
pub async fn replace_all(
    pool: &PgPool,
    user_id: Uuid,
    positions: &[Position],
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM topology_positions WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    for p in positions {
        sqlx::query(
            r#"INSERT INTO topology_positions (user_id, node_id, x, y, updated_at)
               VALUES ($1, $2, $3, $4, NOW())"#,
        )
        .bind(user_id)
        .bind(&p.node_id)
        .bind(p.x)
        .bind(p.y)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
