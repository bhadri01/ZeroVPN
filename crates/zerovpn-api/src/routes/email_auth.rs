//! Email verification + password reset routes.
//!
//! Both flows share the same token table (`verification_tokens`) and the
//! same email-by-link UX. We hash the plaintext token (sha256) at rest so
//! a stolen DB doesn't directly hand over working links.

use axum::{Json, extract::State, response::IntoResponse};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use garde::Validate;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tracing::{info, warn};
use zerovpn_core::models::UserStatus;
use zerovpn_db::repos::{audit, users, verification_tokens};
use zerovpn_db::repos::verification_tokens::TokenPurpose;
use zerovpn_mail::templates::{PasswordReset, VerifyEmail};

use crate::{
    error::{ApiError, ApiResult},
    state::AppState,
};

const VERIFY_TOKEN_TTL: time::Duration = time::Duration::hours(24);
const RESET_TOKEN_TTL: time::Duration = time::Duration::hours(1);

#[derive(Debug, Deserialize, Validate)]
pub struct ForgotBody {
    #[garde(email)]
    pub email: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct VerifyBody {
    #[garde(length(min = 16))]
    pub token: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct ResetBody {
    #[garde(length(min = 16))]
    pub token: String,
    #[garde(length(min = 12, max = 128))]
    pub new_password: String,
}

#[derive(Debug, Serialize)]
pub struct Ack {
    pub status: &'static str,
}

/// Generate a 32-byte URL-safe token + return (plaintext, sha256_hex).
pub fn fresh_token() -> (String, String) {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let plaintext = URL_SAFE_NO_PAD.encode(bytes);
    let mut hasher = Sha256::new();
    hasher.update(plaintext.as_bytes());
    let hash = hex::encode(hasher.finalize());
    (plaintext, hash)
}

pub fn hash_token(plaintext: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(plaintext.as_bytes());
    hex::encode(hasher.finalize())
}

/// Create a new email-verify token + send the link. Idempotent: invalidates
/// any active verify tokens for the user before issuing a new one.
pub async fn issue_verify_email(
    state: &AppState,
    user_id: uuid::Uuid,
    email: &str,
) -> ApiResult<()> {
    verification_tokens::invalidate_active(&state.pool, user_id, TokenPurpose::EmailVerify).await?;
    let (plaintext, hash) = fresh_token();
    verification_tokens::create(
        &state.pool,
        user_id,
        TokenPurpose::EmailVerify,
        &hash,
        VERIFY_TOKEN_TTL,
    )
    .await?;

    let link = format!(
        "{}/verify-email?token={}",
        state.public_url.trim_end_matches('/'),
        plaintext
    );

    if let Some(mailer) = &state.mailer {
        use askama::Template;
        let body = VerifyEmail { link: &link }
            .render()
            .map_err(|e| ApiError::Internal(format!("render: {e}")))?;
        let to: zerovpn_mail::Mailbox = email
            .parse()
            .map_err(|e| ApiError::Internal(format!("invalid to: {e}")))?;
        if let Err(e) = mailer.send(to, "Verify your ZeroVPN email", body).await {
            warn!(?e, "verify email send failed");
        }
    } else {
        info!(%user_id, link, "DEV: verify-email link (no SMTP configured)");
    }
    Ok(())
}

pub async fn verify_email(
    State(state): State<AppState>,
    Json(body): Json<VerifyBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;
    let hash = hash_token(&body.token);
    let token = verification_tokens::find_active(&state.pool, &hash)
        .await?
        .ok_or_else(|| ApiError::Validation("invalid or expired token".into()))?;
    if token.purpose != TokenPurpose::EmailVerify {
        return Err(ApiError::Validation("wrong token purpose".into()));
    }
    sqlx::query(
        r#"UPDATE users
              SET status = 'active',
                  email_verified_at = COALESCE(email_verified_at, NOW())
            WHERE id = $1 AND deleted_at IS NULL"#,
    )
    .bind(token.user_id)
    .execute(&state.pool)
    .await?;
    verification_tokens::consume(&state.pool, token.id).await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(token.user_id),
            action: "user.email_verified",
            target_type: Some("user"),
            target_id: Some(token.user_id),
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    info!(user_id = %token.user_id, "email verified");
    Ok(Json(Ack { status: "ok" }))
}

pub async fn forgot_password(
    State(state): State<AppState>,
    Json(body): Json<ForgotBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;
    let email = body.email.trim().to_lowercase();
    let user = users::find_by_email(&state.pool, &email).await?;

    // Email-enumeration prevention: always return 202. The email is sent
    // only when the user actually exists.
    if let Some(u) = user {
        if u.status == UserStatus::Active || u.status == UserStatus::PendingVerification {
            verification_tokens::invalidate_active(
                &state.pool,
                u.id,
                TokenPurpose::PasswordReset,
            )
            .await?;
            let (plaintext, hash) = fresh_token();
            verification_tokens::create(
                &state.pool,
                u.id,
                TokenPurpose::PasswordReset,
                &hash,
                RESET_TOKEN_TTL,
            )
            .await?;

            let link = format!(
                "{}/reset-password?token={}",
                state.public_url.trim_end_matches('/'),
                plaintext
            );
            if let Some(mailer) = &state.mailer {
                use askama::Template;
                let mail_body = PasswordReset { link: &link }
                    .render()
                    .map_err(|e| ApiError::Internal(format!("render: {e}")))?;
                let to: zerovpn_mail::Mailbox = u
                    .email
                    .parse()
                    .map_err(|e| ApiError::Internal(format!("invalid to: {e}")))?;
                if let Err(e) = mailer.send(to, "Reset your ZeroVPN password", mail_body).await {
                    warn!(?e, "password reset email send failed");
                }
            } else {
                info!(user_id = %u.id, link, "DEV: password-reset link (no SMTP configured)");
            }
        }
    }
    Ok(Json(Ack { status: "ok" }))
}

pub async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<ResetBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;
    let hash = hash_token(&body.token);
    let token = verification_tokens::find_active(&state.pool, &hash)
        .await?
        .ok_or_else(|| ApiError::Validation("invalid or expired token".into()))?;
    if token.purpose != TokenPurpose::PasswordReset {
        return Err(ApiError::Validation("wrong token purpose".into()));
    }
    let pw_hash = zerovpn_auth::password::hash(&body.new_password)?;
    sqlx::query(
        r#"UPDATE users
              SET password_hash = $2,
                  must_change_password = FALSE
            WHERE id = $1 AND deleted_at IS NULL"#,
    )
    .bind(token.user_id)
    .bind(&pw_hash)
    .execute(&state.pool)
    .await?;
    verification_tokens::consume(&state.pool, token.id).await?;
    // Revoke any active sessions so other devices need to re-auth.
    sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(token.user_id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state.pool,
        audit::AuditEntry {
            actor_user_id: Some(token.user_id),
            action: "user.password_reset",
            target_type: Some("user"),
            target_id: Some(token.user_id),
            metadata: json!({}),
            ip_prefix: None,
        },
    )
    .await?;
    info!(user_id = %token.user_id, "password reset");
    Ok(Json(Ack { status: "ok" }))
}

#[derive(Debug, Deserialize, Validate)]
pub struct ResendBody {
    #[garde(email)]
    pub email: String,
}

pub async fn resend_verify(
    State(state): State<AppState>,
    Json(body): Json<ResendBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;
    let email = body.email.trim().to_lowercase();
    if let Some(u) = users::find_by_email(&state.pool, &email).await? {
        if u.status == UserStatus::PendingVerification {
            issue_verify_email(&state, u.id, &u.email).await?;
        }
    }
    Ok(Json(Ack { status: "ok" }))
}
