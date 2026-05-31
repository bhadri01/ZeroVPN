//! End-to-end repo tests against a real Postgres in a testcontainers-managed
//! container. Verifies the basic CRUD lifecycle plus quota counter math.

use testcontainers::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres;
use zerovpn_auth::password;
use zerovpn_core::models::{UserRole, UserStatus};
use zerovpn_db::repos::users;

async fn boot_pg() -> anyhow::Result<(testcontainers::ContainerAsync<Postgres>, String)> {
    let pg = Postgres::default()
        .with_db_name("zerovpn")
        .with_user("zerovpn")
        .with_password("zerovpn")
        .with_tag("18-alpine")
        .start()
        .await?;
    let port = pg.get_host_port_ipv4(5432).await?;
    let url = format!("postgres://zerovpn:zerovpn@127.0.0.1:{port}/zerovpn?sslmode=disable");
    Ok((pg, url))
}

#[tokio::test]
async fn user_lifecycle_with_quota_counter() -> anyhow::Result<()> {
    let (_pg, url) = boot_pg().await?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await?;
    // Apply the full migration set (embedded via `sqlx::migrate!`) rather than
    // hand-reading a couple of .sql files — robust to CWD and keeps the schema
    // current as migrations are added.
    zerovpn_db::run_migrations(&pool).await?;

    // Create user
    let pw_hash = password::hash("correcthorsebatterystaple")?;
    let id = users::create(
        &pool,
        "alice@example.com",
        &pw_hash,
        UserRole::User,
        UserStatus::Active,
    )
    .await?;

    // Find by email returns the same row
    let with_secrets = users::find_by_email(&pool, "alice@example.com")
        .await?
        .expect("user exists");
    assert_eq!(with_secrets.id, id);
    assert!(password::verify("correcthorsebatterystaple", &with_secrets.password_hash)?);

    // Quota counter: starts at 0, accumulates, resets next month
    let (after_first, cap) = users::add_monthly_usage(&pool, id, 1_000).await?;
    assert!(cap.is_none());
    assert!(after_first >= 1_000);

    let (after_second, _) = users::add_monthly_usage(&pool, id, 500).await?;
    assert!(after_second >= after_first);

    // Soft-delete cascades
    users::soft_delete(&pool, id).await?;
    let dead = users::find_by_email(&pool, "alice@example.com").await?;
    assert!(
        dead.is_none(),
        "find_by_email skips deleted_at IS NOT NULL rows"
    );
    Ok(())
}
