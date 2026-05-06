//! sqlx-based data access layer.
//!
//! Holds the connection pool, migration runner, and per-aggregate repositories.
//! This is the only crate in the workspace that imports `sqlx`.

pub mod pool;
pub mod repos;

pub use pool::{PgPool, init_pool, run_migrations};
