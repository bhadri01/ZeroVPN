use time::OffsetDateTime;
use uuid::Uuid;
use zerovpn_core::models::{User, UserRole, UserStatus};

use crate::PgPool;

pub async fn find_by_email(pool: &PgPool, email: &str) -> sqlx::Result<Option<UserWithSecrets>> {
    sqlx::query_as::<_, UserWithSecrets>(
        r#"SELECT id, email::TEXT AS email, password_hash, role, status,
                  must_change_password, email_verified_at, totp_enabled,
                  created_at, last_login_at
           FROM users
           WHERE email = $1::CITEXT AND deleted_at IS NULL"#,
    )
    .bind(email)
    .fetch_optional(pool)
    .await
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        r#"SELECT id, email::TEXT AS email, role, status, must_change_password,
                  email_verified_at, totp_enabled, created_at, last_login_at
           FROM users
           WHERE id = $1 AND deleted_at IS NULL"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create(
    pool: &PgPool,
    email: &str,
    password_hash: &str,
    role: UserRole,
    status: UserStatus,
) -> sqlx::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO users (id, email, password_hash, role, status)
           VALUES ($1, $2::CITEXT, $3, $4, $5)"#,
    )
    .bind(id)
    .bind(email)
    .bind(password_hash)
    .bind(role)
    .bind(status)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn touch_last_login(pool: &PgPool, id: Uuid) -> sqlx::Result<()> {
    sqlx::query("UPDATE users SET last_login_at = $2 WHERE id = $1")
        .bind(id)
        .bind(OffsetDateTime::now_utc())
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn count_active_admins(pool: &PgPool) -> sqlx::Result<i64> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL",
    )
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

/// User row including the password hash. Only used by the auth crate; never
/// returned over the API.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserWithSecrets {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub role: UserRole,
    pub status: UserStatus,
    pub must_change_password: bool,
    pub email_verified_at: Option<OffsetDateTime>,
    pub totp_enabled: bool,
    pub created_at: OffsetDateTime,
    pub last_login_at: Option<OffsetDateTime>,
}

impl From<UserWithSecrets> for User {
    fn from(u: UserWithSecrets) -> Self {
        User {
            id: u.id,
            email: u.email,
            role: u.role,
            status: u.status,
            must_change_password: u.must_change_password,
            email_verified_at: u.email_verified_at,
            totp_enabled: u.totp_enabled,
            created_at: u.created_at,
            last_login_at: u.last_login_at,
        }
    }
}
