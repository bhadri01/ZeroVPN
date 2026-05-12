use axum::{
    Json,
    extract::State,
    http::HeaderMap,
    response::IntoResponse,
};
use garde::Validate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::IpAddr;
use time::OffsetDateTime;
use tower_sessions::Session;
use tracing::{info, warn};
use zerovpn_core::models::{User, UserRole, UserStatus};
use zerovpn_db::repos::{audit, failed_logins, users};

/// Best-effort client IP from the `X-Forwarded-For` header (Caddy populates
/// this) or the `X-Real-IP` header. Returns `None` if neither is present.
/// Reduces the IP to a /24 (IPv4) or /48 (IPv6) prefix to honor our no-logs
/// stance — we only want to detect *change*, not pinpoint location.
fn client_ip_prefix(headers: &HeaderMap) -> Option<ipnetwork::IpNetwork> {
    let raw = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())?;
    // X-Forwarded-For can be a comma-separated list; the leftmost is the
    // client, the rest are proxies. We only trust the leftmost as a coarse
    // identifier — anything beyond that is hop-by-hop.
    let first = raw.split(',').next()?.trim();
    let ip: IpAddr = first.parse().ok()?;
    Some(match ip {
        IpAddr::V4(v4) => {
            let net = ipnetwork::Ipv4Network::new(v4, 24).ok()?.network();
            ipnetwork::IpNetwork::V4(ipnetwork::Ipv4Network::new(net, 24).ok()?)
        }
        IpAddr::V6(v6) => {
            let net = ipnetwork::Ipv6Network::new(v6, 48).ok()?.network();
            ipnetwork::IpNetwork::V6(ipnetwork::Ipv6Network::new(net, 48).ok()?)
        }
    })
}

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::{CurrentUser, SESSION_KEY_PW_CHANGED_AT, SESSION_KEY_USER_ID},
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

    // Always respond 200 with the same shape regardless of whether the
    // email is already taken (enumeration prevention). New accounts are
    // created as `pending_verification` and a verify-email link is sent;
    // the user can only sign in after clicking it.
    if existing.is_none() {
        let pw_hash = zerovpn_auth::password::hash(&body.password)?;
        // Decide role: first user becomes admin, everyone else becomes user.
        let admins = users::count_active_admins(&state.pool).await?;
        let role = if admins == 0 { UserRole::Admin } else { UserRole::User };
        let user_id = users::create(
            &state.pool,
            &email,
            &pw_hash,
            role,
            UserStatus::PendingVerification,
        )
        .await?;

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

        if let Err(e) =
            crate::routes::email_auth::issue_verify_email(&state, user_id, &email).await
        {
            warn!(?e, %user_id, "failed to issue verify-email on register");
        }
    } else if let Some(u) = existing {
        // Re-trigger the verification email when an unverified account
        // signs up again with the same address. Active/suspended accounts
        // get no email — same response shape keeps enumeration closed.
        if u.status == UserStatus::PendingVerification {
            if let Err(e) =
                crate::routes::email_auth::issue_verify_email(&state, u.id, &u.email).await
            {
                warn!(?e, user_id = %u.id, "failed to re-issue verify-email on register");
            }
        }
    }

    Ok(Json(RegisterAck { status: "ok" }))
}

#[derive(Debug, Deserialize, Validate)]
pub struct LoginBody {
    #[garde(email)]
    pub email: String,
    #[garde(length(min = 1))]
    pub password: String,
    /// 6-digit TOTP code (or 8-char recovery code). Required when the user
    /// has 2FA enabled; ignored otherwise.
    #[serde(default)]
    #[garde(skip)]
    pub totp_code: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub user: PublicUser,
    pub must_change_password: bool,
    pub totp_required: bool,
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
    headers: HeaderMap,
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
        return Err(ApiError::EmailNotVerified);
    }

    // 2FA challenge if enabled.
    if user_with_secrets.totp_enabled {
        let code = match body.totp_code.as_deref() {
            Some(c) if !c.is_empty() => c,
            _ => {
                // Correct password but missing second factor — return a
                // hint to the client so the form can prompt for the code.
                return Ok(Json(LoginResponse {
                    user: PublicUser {
                        id: user_with_secrets.id,
                        email: user_with_secrets.email.clone(),
                        role: user_with_secrets.role,
                    },
                    must_change_password: user_with_secrets.must_change_password,
                    totp_required: true,
                }));
            }
        };
        let ok = verify_totp_or_recovery(&state, user_with_secrets.id, code).await?;
        if !ok {
            failed_logins::record(
                &state.pool,
                Some(&email),
                None,
                None,
                failed_logins::FailedLoginReason::TotpFailed,
            )
            .await?;
            return Err(ApiError::Unauthorized);
        }
    }

    session
        .insert(SESSION_KEY_USER_ID, user_with_secrets.id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    // Snapshot the password watermark into the session. Stored as unix
    // seconds so the JSON value is trivially diffable on every request
    // — see CurrentUser extractor for the comparison.
    session
        .insert(
            SESSION_KEY_PW_CHANGED_AT,
            user_with_secrets.password_changed_at.unix_timestamp(),
        )
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    users::touch_last_login(&state.pool, user_with_secrets.id).await?;

    // Suspicious-login detection: compare the /24 (or /48) prefix of the
    // current request to the prefix of the last successful login. If the
    // prefix differs and a previous one existed, fire an info email so the
    // user can flag it. First-ever login establishes the baseline silently.
    if let Some(new_prefix) = client_ip_prefix(&headers) {
        match users::swap_last_login_ip_prefix(
            &state.pool,
            user_with_secrets.id,
            new_prefix,
        )
        .await
        {
            Ok(Some(prev)) if prev != new_prefix => {
                if let Some(mailer) = &state.mailer {
                    use askama::Template;
                    let when = OffsetDateTime::now_utc()
                        .format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_else(|_| "(unknown)".into());
                    let security_link = format!(
                        "{}/app/security",
                        state.public_url.trim_end_matches('/'),
                    );
                    let body = zerovpn_mail::templates::SuspiciousLogin {
                        email: &user_with_secrets.email,
                        when: &when,
                        security_link: &security_link,
                    }
                    .render()
                    .unwrap_or_default();
                    if let Ok(to) = user_with_secrets.email.parse::<zerovpn_mail::Mailbox>()
                    {
                        let mailer = mailer.clone();
                        let subj = "New sign-in to your ZeroVPN account";
                        tokio::spawn(async move {
                            if let Err(e) = mailer.send(to, subj, body).await {
                                warn!(?e, "suspicious-login email send failed");
                            }
                        });
                    }
                }
                let _ = audit::record(
                    &state.pool,
                    audit::AuditEntry {
                        actor_user_id: Some(user_with_secrets.id),
                        action: "auth.new_ip_prefix",
                        target_type: Some("user"),
                        target_id: Some(user_with_secrets.id),
                        metadata: json!({
                            "prev": prev.to_string(),
                            "new": new_prefix.to_string(),
                        }),
                        ip_prefix: Some(new_prefix),
                    },
                )
                .await;
            }
            Ok(_) => {}
            Err(e) => warn!(?e, "swap_last_login_ip_prefix failed"),
        }
    }

    let totp_enabled = user_with_secrets.totp_enabled;
    let user: User = user_with_secrets.into();
    let must_change = user.must_change_password;
    info!(user_id = %user.id, role = ?user.role, totp = totp_enabled, "login");

    Ok(Json(LoginResponse {
        user: PublicUser { id: user.id, email: user.email, role: user.role },
        must_change_password: must_change,
        totp_required: false,
    }))
}

/// Verify a code against the stored TOTP secret OR consume a recovery code.
/// On a successful recovery match, that code is removed from the user's set.
async fn verify_totp_or_recovery(
    state: &AppState,
    user_id: uuid::Uuid,
    code: &str,
) -> ApiResult<bool> {
    let (secret_encrypted, recovery_hashes) =
        match users::get_totp_material(&state.pool, user_id).await? {
            Some(t) => t,
            None => return Ok(false),
        };
    let secret_bytes = state
        .kek
        .decrypt(&secret_encrypted)
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let secret = String::from_utf8(secret_bytes)
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if let Ok(true) = zerovpn_auth::totp::verify(&secret, code) {
        return Ok(true);
    }
    if let Ok(Some(idx)) = zerovpn_auth::totp::match_recovery_code(code, &recovery_hashes) {
        let mut remaining = recovery_hashes.clone();
        remaining.remove(idx);
        users::replace_recovery_codes(&state.pool, user_id, &remaining).await?;
        return Ok(true);
    }
    Ok(false)
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
