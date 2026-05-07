use axum::{Json, extract::State, response::IntoResponse};
use garde::Validate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use tower_sessions::Session;
use tracing::info;
use zerovpn_core::models::{User, UserRole, UserStatus};
use zerovpn_db::repos::{audit, failed_logins, users};

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::{CurrentUser, SESSION_KEY_USER_ID},
    state::AppState,
};

#[derive(Debug, Deserialize, Validate)]
pub struct RegisterBody {
    #[garde(email)]
    pub email: String,
    #[garde(length(min = 12, max = 128))]
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct RegisterAck {
    /// Always returned regardless of whether the email is already taken
    /// (enumeration prevention). The actual account creation only happens
    /// for new emails.
    pub status: &'static str,
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;

    let email = body.email.trim().to_lowercase();
    let existing = users::find_by_email(&state.pool, &email).await?;

    // Always respond 202, even if the user exists. We're stubbing email
    // verification for Phase 1A — accounts come up as pending_verification
    // and Phase 1B will wire the actual email send.
    if existing.is_none() {
        let pw_hash = zerovpn_auth::password::hash(&body.password)?;
        // Decide role: first user becomes admin, everyone else becomes user.
        let admins = users::count_active_admins(&state.pool).await?;
        let role = if admins == 0 { UserRole::Admin } else { UserRole::User };
        // Phase 1A: auto-activate (no email verification round-trip yet).
        let user_id =
            users::create(&state.pool, &email, &pw_hash, role, UserStatus::Active).await?;

        audit::record(
            &state.pool,
            audit::AuditEntry {
                actor_user_id: Some(user_id),
                action: "user.registered",
                target_type: Some("user"),
                target_id: Some(user_id),
                metadata: json!({ "role": role }),
                ip_prefix: None,
            },
        )
        .await?;
        info!(%user_id, ?role, "user registered");
    }

    Ok(Json(RegisterAck { status: "ok" }))
}

#[derive(Debug, Deserialize, Validate)]
pub struct LoginBody {
    #[garde(email)]
    pub email: String,
    #[garde(length(min = 1))]
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub user: PublicUser,
    pub must_change_password: bool,
}

#[derive(Debug, Serialize)]
pub struct PublicUser {
    pub id: uuid::Uuid,
    pub email: String,
    pub role: UserRole,
}

pub async fn login(
    State(state): State<AppState>,
    session: Session,
    Json(body): Json<LoginBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;
    let email = body.email.trim().to_lowercase();

    // Rate limit: more than 5 failed attempts in 15 minutes for this email
    // gets short-circuited.
    let recent_failures = failed_logins::recent_for_email(&state.pool, &email, 15 * 60).await?;
    if recent_failures >= 5 {
        failed_logins::record(
            &state.pool,
            Some(&email),
            None,
            None,
            failed_logins::FailedLoginReason::RateLimited,
        )
        .await?;
        return Err(ApiError::RateLimited);
    }

    let user_with_secrets = users::find_by_email(&state.pool, &email).await?;
    let user_with_secrets = match user_with_secrets {
        Some(u) => u,
        None => {
            // Pad with a slow-but-fixed cost to defeat email enumeration via
            // timing differences.
            let _ = zerovpn_auth::password::hash(&body.password);
            failed_logins::record(
                &state.pool,
                Some(&email),
                None,
                None,
                failed_logins::FailedLoginReason::UnknownEmail,
            )
            .await?;
            return Err(ApiError::Unauthorized);
        }
    };

    let ok = zerovpn_auth::password::verify(&body.password, &user_with_secrets.password_hash)?;
    if !ok {
        failed_logins::record(
            &state.pool,
            Some(&email),
            None,
            None,
            failed_logins::FailedLoginReason::WrongPassword,
        )
        .await?;
        return Err(ApiError::Unauthorized);
    }

    if user_with_secrets.status == UserStatus::Suspended {
        failed_logins::record(
            &state.pool,
            Some(&email),
            None,
            None,
            failed_logins::FailedLoginReason::AccountSuspended,
        )
        .await?;
        return Err(ApiError::Forbidden);
    }

    if user_with_secrets.status == UserStatus::PendingVerification {
        failed_logins::record(
            &state.pool,
            Some(&email),
            None,
            None,
            failed_logins::FailedLoginReason::AccountPendingVerification,
        )
        .await?;
        return Err(ApiError::Forbidden);
    }

    session
        .insert(SESSION_KEY_USER_ID, user_with_secrets.id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    users::touch_last_login(&state.pool, user_with_secrets.id).await?;

    let user: User = user_with_secrets.into();
    let must_change = user.must_change_password;
    info!(user_id = %user.id, role = ?user.role, "login");

    Ok(Json(LoginResponse {
        user: PublicUser { id: user.id, email: user.email, role: user.role },
        must_change_password: must_change,
    }))
}

pub async fn logout(session: Session) -> ApiResult<impl IntoResponse> {
    session
        .flush()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!({ "status": "ok" })))
}

pub async fn me(CurrentUser(user): CurrentUser) -> impl IntoResponse {
    Json(PublicUser { id: user.id, email: user.email, role: user.role })
}

#[allow(dead_code)]
fn _unused_offsetdatetime() -> OffsetDateTime {
    OffsetDateTime::now_utc()
}
