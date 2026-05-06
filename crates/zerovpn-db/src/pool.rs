use sqlx::postgres::{PgPoolOptions, PgPool as SqlxPool};
use std::time::Duration;

pub type PgPool = SqlxPool;

pub async fn init_pool(database_url: &str, max_connections: u32) -> sqlx::Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Some(Duration::from_secs(60 * 10)))
        .max_lifetime(Some(Duration::from_secs(60 * 60)))
        .connect(database_url)
        .await
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("../../migrations").run(pool).await
}
