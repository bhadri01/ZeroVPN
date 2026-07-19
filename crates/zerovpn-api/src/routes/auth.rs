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
use utoipa::ToSchema;
use zerovpn_core::models::{User, UserRole, UserStatus};
use zerovpn_db::repos::{audit, failed_logins, session_events, users};
use zerovpn_wire::{Event, NotifyLevel};

/// Best-effort full client IP from the `X-Forwarded-For` header (the reverse
/// proxy populates this) or the `X-Real-IP` header. Returns `None` if neither
/// is present. Wrapped in `IpNetwork` as a `/32` (v4) or `/128` (v6)
/// host prefix so it lands directly into the `INET`-typed columns
/// (`audit_logs.ip`, `failed_logins.ip`, etc).
///
/// **Phase 2 / Stage A** — the previous implementation truncated to
/// `/24` (v4) or `/48` (v6) to keep the recorded address coarse-grained.
/// That truncation is gone: admins want to see the actual address.
/// **Stage B (migration 20)** completed the schema rename — the columns
/// are now plain `ip` everywhere.
pub(crate) fn client_ip(headers: &HeaderMap) -> Option<ipnetwork::IpNetwork> {
    let raw = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())?;
    // X-Forwarded-For can be a comma-separated list; the leftmost is the
    // client, the rest are proxies. We only trust the leftmost — anything
    // beyond that is hop-by-hop and can be spoofed by intermediate hops.
    let first = raw.split(',').next()?.trim();
    let ip: IpAddr = first.parse().ok()?;
    Some(ipnetwork::IpNetwork::from(ip))
}

/// Raw `User-Agent` header, lowercased and trimmed. Returned for storage
/// in `failed_logins.user_agent` / `sessions.user_agent` — admins use it
/// to spot brute-force tooling (`curl/...`, `python-requests/...`) and
/// to correlate suspicious-login emails with the browser the user was
/// actually on. Stored in plaintext, no longer hashed.
pub(crate) fn client_user_agent(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(axum::http::header::USER_AGENT)?.to_str().ok()?.trim();
    if raw.is_empty() {
        None
    } else {
        Some(raw.to_string())
    }
}

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::{CurrentUser, SESSION_KEY_PW_CHANGED_AT, SESSION_KEY_REAL_USER_ID, SESSION_KEY_USER_ID},
    routes::dto::StatusAck,
    state::AppState,
};

#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct RegisterBody {
    #[garde(email)]
    pub email: String,
    #[garde(length(min = 12, max = 128))]
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RegisterAck {
    /// Always returned regardless of whether the email is already taken
    /// (enumeration prevention). The actual account creation only happens
    /// for new emails.
    #[schema(example = "ok")]
    pub status: &'static str,
}

#[utoipa::path(
    post,
    path = "/auth/register",
    tag = "Auth",
    request_body = RegisterBody,
    responses(
        (status = 200, description = "Acknowledged (enumeration-safe — same shape whether email is new or taken)", body = RegisterAck),
        (status = 400, description = "Validation error"),
    ),
)]
pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
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

        let ua = client_user_agent(&headers);
        audit::record_with_ua(
            &state.pool,
            audit::AuditEntry {
                actor_user_id: Some(user_id),
                action: "user.registered",
                target_type: Some("user"),
                target_id: Some(user_id),
                metadata: json!({ "role": role }),
                ip: client_ip(&headers),
            },
            ua.as_deref(),
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

#[derive(Debug, Deserialize, Validate, ToSchema)]
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

#[derive(Debug, Serialize, ToSchema)]
pub struct LoginResponse {
    pub user: PublicUser,
    pub must_change_password: bool,
    pub totp_required: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PublicUser {
    pub id: uuid::Uuid,
    pub email: String,
    pub role: UserRole,
    /// True when the user has finished TOTP enrollment. Surfaced here
    /// so the frontend can auto-detect 2FA status on the Security page
    /// instead of guessing.
    pub totp_enabled: bool,
    /// True when the current session is an admin impersonating this account.
    #[serde(default)]
    pub is_impersonated: bool,
    /// Email of the admin who initiated impersonation. Only present when
    /// `is_impersonated` is true.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impersonator_email: Option<String>,
    /// Admin-set global toggles that govern what *non-admin* users see in
    /// the user-facing app. Always present on `/me`, the login response,
    /// and the email-verify response so the SPA can gate routes/links from
    /// first paint without an extra round-trip. Admins should ignore these
    /// — backend handlers exempt admins from policy gating.
    pub user_policy: UserPolicySnapshot,
}

#[derive(Debug, Serialize, ToSchema, Default, sqlx::FromRow)]
pub struct UserPolicySnapshot {
    pub hide_device_detail: bool,
}

/// Fetch the current global user policy. Mirrors the shape returned by
/// `GET /admin/user-policy` but is used to enrich every PublicUser
/// response so the frontend learns the policy on login / page-load
/// without a separate request. Falls back to permissive defaults on
/// query failure so a transient DB hiccup never locks users out.
pub async fn load_user_policy(pool: &zerovpn_db::PgPool) -> UserPolicySnapshot {
    sqlx::query_as::<_, UserPolicySnapshot>(
        "SELECT policy_hide_device_detail AS hide_device_detail
           FROM app_settings WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .unwrap_or_default()
}

#[utoipa::path(
    post,
    path = "/auth/login",
    tag = "Auth",
    request_body = LoginBody,
    responses(
        (status = 200, description = "Session established. `must_change_password` and `totp_required` are gates the client must honor before unlocking the dashboard.", body = LoginResponse),
        (status = 401, description = "Bad credentials, missing TOTP code, or wrong TOTP code"),
        (status = 403, description = "Account suspended"),
        (status = 429, description = "Too many recent failed attempts for this email"),
    ),
)]
pub async fn login(
    State(state): State<AppState>,
    session: Session,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> ApiResult<impl IntoResponse> {
    body.validate().map_err(|e| ApiError::Validation(e.to_string()))?;
    let email = body.email.trim().to_lowercase();
    // Capture once; pass into every failed_logins::record call below so
    // admins can correlate brute-force patterns by IP and user-agent.
    let req_ip = client_ip(&headers);
    let req_ua = client_user_agent(&headers);

    // Rate limit: more than 5 failed attempts in 15 minutes for this email
    // gets short-circuited.
    let recent_failures = failed_logins::recent_for_email(&state.pool, &email, 15 * 60).await?;
    if recent_failures >= 5 {
        failed_logins::record(
            &state.pool,
            Some(&email),
            req_ip,
            req_ua.as_deref(),
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
                req_ip,
                req_ua.as_deref(),
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
            req_ip,
            req_ua.as_deref(),
            failed_logins::FailedLoginReason::WrongPassword,
        )
        .await?;
        return Err(ApiError::Unauthorized);
    }

    if user_with_secrets.status == UserStatus::Suspended {
        failed_logins::record(
            &state.pool,
            Some(&email),
            req_ip,
            req_ua.as_deref(),
            failed_logins::FailedLoginReason::AccountSuspended,
        )
        .await?;
        return Err(ApiError::Forbidden);
    }

    if user_with_secrets.status == UserStatus::PendingVerification {
        failed_logins::record(
            &state.pool,
            Some(&email),
            req_ip,
            req_ua.as_deref(),
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
                let user_policy = load_user_policy(&state.pool).await;
                return Ok(Json(LoginResponse {
                    user: PublicUser {
                        id: user_with_secrets.id,
                        email: user_with_secrets.email.clone(),
                        role: user_with_secrets.role,
                        totp_enabled: user_with_secrets.totp_enabled,
                        is_impersonated: false,
                        impersonator_email: None,
                        user_policy,
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
                req_ip,
                req_ua.as_deref(),
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

    // Phase 2 / Stage B — record the login on session_events. Best-effort:
    // a transient DB error here must not block the login response. The
    // audit log already captured the action via the failed_logins path /
    // touch_last_login, so the session_events miss is recoverable.
    if let Err(e) = session_events::record(
        &state.pool,
        user_with_secrets.id,
        session_events::SessionEvent::Login,
        req_ip,
        req_ua.as_deref(),
        json!({}),
    )
    .await
    {
        warn!(?e, user_id = %user_with_secrets.id, "session_events login record failed");
    }

    // Suspicious-login detection: compare the current request's IP to the
    // last successful login. If they differ and a previous one existed,
    // fire an info email so the user can flag it. First-ever login
    // establishes the baseline silently.
    //
    // Stage A — we now compare *full* IPs, not /24 prefixes. That makes
    // the alert more sensitive (mobile / VPN reconnects with a new
    // public IP will trip it) but matches the new full-logging policy.
    // Stage B (migration 20) finished the schema rename — column is
    // `users.last_login_ip`, helper is `users::swap_last_login_ip`.
    if let Some(new_ip) = req_ip {
        match users::swap_last_login_ip(
            &state.pool,
            user_with_secrets.id,
            new_ip,
        )
        .await
        {
            Ok(Some(prev)) if prev != new_ip => {
                if let Some(mailer) = &state.mailer {
                    let when = OffsetDateTime::now_utc()
                        .format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_else(|_| "(unknown)".into());
                    let security_link = format!(
                        "{}/app/settings#security",
                        state.public_url.trim_end_matches('/'),
                    );
                    let ip_str = new_ip.ip().to_string();
                    let email = zerovpn_mail::templates::SuspiciousLogin {
                        email: &user_with_secrets.email,
                        when: &when,
                        security_link: &security_link,
                        ip: Some(&ip_str),
                        user_agent: req_ua.as_deref(),
                    };
                    // Render before the spawn so the future doesn't
                    // capture any borrowed refs from this scope.
                    use zerovpn_mail::templates::Email;
                    let subject = email.subject().to_string();
                    let text = email.render_text().unwrap_or_default();
                    let html = email.render_html().unwrap_or_default();
                    if let Ok(to) = user_with_secrets.email.parse::<zerovpn_mail::Mailbox>()
                    {
                        let mailer = mailer.clone();
                        tokio::spawn(async move {
                            if let Err(e) = mailer
                                .send_rendered(to, subject, text, html)
                                .await
                            {
                                warn!(?e, "suspicious-login email send failed");
                            }
                        });
                    }
                }
                let _ = audit::record_with_ua(
                    &state.pool,
                    audit::AuditEntry {
                        actor_user_id: Some(user_with_secrets.id),
                        action: "auth.new_ip",
                        target_type: Some("user"),
                        target_id: Some(user_with_secrets.id),
                        metadata: json!({
                            "prev": prev.to_string(),
                            "new": new_ip.to_string(),
                        }),
                        ip: Some(new_ip),
                    },
                    req_ua.as_deref(),
                )
                .await;
                // Phase 2 / Stage B — session_events sibling row. Carries
                // the previous IP in metadata so the admin Sessions page
                // can render the diff inline.
                let _ = session_events::record(
                    &state.pool,
                    user_with_secrets.id,
                    session_events::SessionEvent::SuspiciousLogin,
                    Some(new_ip),
                    req_ua.as_deref(),
                    json!({ "previous_ip": prev.to_string() }),
                )
                .await;
                // Real-time security alert to the user's *other* sessions (the
                // one signing in here isn't on the WS yet, so it won't see its
                // own alert). Mirrors the suspicious-login email on the live
                // channel so a backgrounded device gets an OS notification.
                state.broadcast(Event::Notify {
                    user_id: Some(user_with_secrets.id),
                    level: NotifyLevel::Warning,
                    title: "New sign-in to your account".to_string(),
                    body: Some(format!(
                        "A new sign-in from {}. If this wasn't you, change your password.",
                        new_ip.ip()
                    )),
                    url: Some("/app/settings".to_string()),
                    tag: None,
                });
            }
            Ok(_) => {}
            Err(e) => warn!(?e, "swap_last_login_ip failed"),
        }
    }

    let totp_enabled = user_with_secrets.totp_enabled;
    let user: User = user_with_secrets.into();
    let must_change = user.must_change_password;
    info!(user_id = %user.id, role = ?user.role, totp = totp_enabled, "login");

    let user_policy = load_user_policy(&state.pool).await;
    Ok(Json(LoginResponse {
        user: PublicUser {
            id: user.id,
            email: user.email,
            role: user.role,
            totp_enabled: user.totp_enabled,
            is_impersonated: false,
            impersonator_email: None,
            user_policy,
        },
        must_change_password: must_change,
        totp_required: false,
    }))
}

/// Verify a code against the stored TOTP secret OR consume a recovery code.
/// On a successful recovery match, that code is removed from the user's set.
pub(crate) async fn verify_totp_or_recovery(
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

#[utoipa::path(
    post,
    path = "/auth/logout",
    tag = "Auth",
    responses(
        (status = 200, description = "Session flushed", body = StatusAck),
    ),
    security(("session_cookie" = [])),
)]
pub async fn logout(
    State(state): State<AppState>,
    session: Session,
    headers: HeaderMap,
) -> ApiResult<impl IntoResponse> {
    // Read the user_id off the session *before* flush so we can attribute
    // the session_events row. Missing key (already logged out / never
    // authed) is fine — we just skip the record.
    let user_id: Option<uuid::Uuid> = session
        .get(SESSION_KEY_USER_ID)
        .await
        .ok()
        .flatten();
    session
        .flush()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if let Some(uid) = user_id {
        if let Err(e) = session_events::record(
            &state.pool,
            uid,
            session_events::SessionEvent::Logout,
            client_ip(&headers),
            client_user_agent(&headers).as_deref(),
            json!({}),
        )
        .await
        {
            warn!(?e, user_id = %uid, "session_events logout record failed");
        }
    }
    Ok(Json(json!({ "status": "ok" })))
}

#[utoipa::path(
    get,
    path = "/me",
    tag = "Account",
    responses(
        (status = 200, description = "Authenticated user", body = PublicUser),
        (status = 401, description = "No session"),
    ),
    security(("session_cookie" = [])),
)]
pub async fn me(
    State(state): State<AppState>,
    session: Session,
    CurrentUser(user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    let real_user_id: Option<uuid::Uuid> = session
        .get(SESSION_KEY_REAL_USER_ID)
        .await
        .unwrap_or(None);

    let impersonator_email = if let Some(rid) = real_user_id {
        users::find_by_id(&state.pool, rid)
            .await?
            .map(|u| u.email)
    } else {
        None
    };

    let user_policy = load_user_policy(&state.pool).await;
    Ok(Json(PublicUser {
        id: user.id,
        email: user.email,
        role: user.role,
        totp_enabled: user.totp_enabled,
        is_impersonated: impersonator_email.is_some(),
        impersonator_email,
        user_policy,
    }))
}
