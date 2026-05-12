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

/// Atomically swap the user's last-login IP prefix and return the value that
/// was previously stored. Uses a CTE to capture the OLD value before the
/// UPDATE replaces it, so the caller can compare without a read-then-write
/// race.
pub async fn swap_last_login_ip_prefix(
    pool: &PgPool,
    id: Uuid,
    new_prefix: ipnetwork::IpNetwork,
) -> sqlx::Result<Option<ipnetwork::IpNetwork>> {
    let row: Option<(Option<ipnetwork::IpNetwork>,)> = sqlx::query_as(
        r#"WITH old AS (
               SELECT last_login_ip_prefix FROM users WHERE id = $1 FOR UPDATE
           ),
           upd AS (
               UPDATE users SET last_login_ip_prefix = $2 WHERE id = $1
           )
           SELECT last_login_ip_prefix FROM old"#,
    )
    .bind(id)
    .bind(new_prefix)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| r.0))
}

/// Increment a user's monthly bandwidth counter. Resets the counter at the
/// start of a new month. Returns the new total + cap; caller decides whether
/// to enforce.
pub async fn add_monthly_usage(
    pool: &PgPool,
    user_id: Uuid,
    delta_bytes: i64,
) -> sqlx::Result<(i64, Option<i64>)> {
    let now = OffsetDateTime::now_utc();
    let next_reset = first_of_next_month(now);

    let row: Option<(i64, Option<i64>)> = sqlx::query_as(
        r#"UPDATE users
              SET current_month_bytes = CASE
                    WHEN quota_resets_at IS NULL OR quota_resets_at < $2
                      THEN $3
                    ELSE current_month_bytes + $3
                  END,
                  quota_resets_at = CASE
                    WHEN quota_resets_at IS NULL OR quota_resets_at < $2
                      THEN $4
                    ELSE quota_resets_at
                  END
            WHERE id = $1 AND deleted_at IS NULL
        RETURNING current_month_bytes, monthly_byte_cap"#,
    )
    .bind(user_id)
    .bind(now)
    .bind(delta_bytes)
    .bind(next_reset)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or((0, None)))
}

fn first_of_next_month(t: OffsetDateTime) -> OffsetDateTime {
    let (y, m, _d) = (t.year(), t.month(), t.day());
    let (ny, nm) = if m == time::Month::December {
        (y + 1, time::Month::January)
    } else {
        (y, m.next())
    };
    let date = time::Date::from_calendar_date(ny, nm, 1).expect("valid first-of-month");
    OffsetDateTime::new_utc(date, time::Time::MIDNIGHT)
}

pub async fn count_active_admins(pool: &PgPool) -> sqlx::Result<i64> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL",
    )
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

/// Persist enrolled TOTP material (encrypted secret + hashed recovery codes).
pub async fn enable_totp(
    pool: &PgPool,
    user_id: Uuid,
    secret_encrypted: &[u8],
    recovery_hashes: &[String],
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE users
              SET totp_enabled = TRUE,
                  totp_secret_encrypted = $2,
                  totp_recovery_codes_hashed = $3
            WHERE id = $1"#,
    )
    .bind(user_id)
    .bind(secret_encrypted)
    .bind(recovery_hashes)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn disable_totp(pool: &PgPool, user_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE users
              SET totp_enabled = FALSE,
                  totp_secret_encrypted = NULL,
                  totp_recovery_codes_hashed = NULL
            WHERE id = $1"#,
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_totp_material(
    pool: &PgPool,
    user_id: Uuid,
) -> sqlx::Result<Option<(Vec<u8>, Vec<String>)>> {
    let row: Option<(Option<Vec<u8>>, Option<Vec<String>>)> = sqlx::query_as(
        "SELECT totp_secret_encrypted, totp_recovery_codes_hashed FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(secret, codes)| match (secret, codes) {
        (Some(s), Some(c)) => Some((s, c)),
        _ => None,
    }))
}

pub async fn replace_recovery_codes(
    pool: &PgPool,
    user_id: Uuid,
    new_codes: &[String],
) -> sqlx::Result<()> {
    sqlx::query("UPDATE users SET totp_recovery_codes_hashed = $2 WHERE id = $1")
        .bind(user_id)
        .bind(new_codes)
        .execute(pool)
        .await?;
    Ok(())
}

/// Soft-delete a user — null PII, revoke devices/sessions/tokens.
pub async fn soft_delete(pool: &PgPool, user_id: Uuid) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"UPDATE users
              SET deleted_at = NOW(),
                  status = 'deleted',
                  email = ('deleted-' || id::TEXT || '@deleted.invalid')::CITEXT,
                  password_hash = '!',
                  totp_enabled = FALSE,
                  totp_secret_encrypted = NULL,
                  totp_recovery_codes_hashed = NULL
            WHERE id = $1"#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE devices SET status = 'revoked' WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Row used by the admin user list page.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AdminUserRow {
    pub id: Uuid,
    pub email: String,
    pub role: UserRole,
    pub status: UserStatus,
    pub totp_enabled: bool,
    pub created_at: OffsetDateTime,
    pub last_login_at: Option<OffsetDateTime>,
    pub device_count: i64,
}

pub async fn admin_list(
    pool: &PgPool,
    limit: i64,
    offset: i64,
    search: Option<&str>,
) -> sqlx::Result<Vec<AdminUserRow>> {
    let pattern = search.map(|s| format!("%{}%", s.to_lowercase()));
    sqlx::query_as::<_, AdminUserRow>(
        r#"SELECT u.id, u.email::TEXT AS email, u.role, u.status, u.totp_enabled,
                  u.created_at, u.last_login_at,
                  (SELECT COUNT(*) FROM devices d
                    WHERE d.user_id = u.id AND d.status <> 'revoked') AS device_count
             FROM users u
            WHERE u.deleted_at IS NULL
              AND ($3::TEXT IS NULL OR LOWER(u.email::TEXT) LIKE $3)
            ORDER BY u.created_at DESC
            LIMIT $1 OFFSET $2"#,
    )
    .bind(limit)
    .bind(offset)
    .bind(pattern)
    .fetch_all(pool)
    .await
}

pub async fn admin_count(pool: &PgPool, search: Option<&str>) -> sqlx::Result<i64> {
    let pattern = search.map(|s| format!("%{}%", s.to_lowercase()));
    let row: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM users
            WHERE deleted_at IS NULL
              AND ($1::TEXT IS NULL OR LOWER(email::TEXT) LIKE $1)"#,
    )
    .bind(pattern)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn admin_set_status(
    pool: &PgPool,
    user_id: Uuid,
    status: UserStatus,
) -> sqlx::Result<u64> {
    let res = sqlx::query(
        "UPDATE users SET status = $2 WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(user_id)
    .bind(status)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
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
