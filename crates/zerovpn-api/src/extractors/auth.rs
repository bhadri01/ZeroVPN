use axum::{
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use time::OffsetDateTime;
use tower_sessions::Session;
use uuid::Uuid;
use zerovpn_core::models::{User, UserRole, UserStatus};

use crate::{error::ApiError, state::AppState};

pub const SESSION_KEY_USER_ID: &str = "user_id";
/// Snapshot of `users.password_changed_at` at the time the session was
/// minted. The extractor compares this against the live row on every
/// request — a mismatch means the user's password has changed since
/// this session was created, so the session is no longer trustworthy
/// and is rejected with 401. This is how password reset / change-
/// password flows kill all outstanding sessions without us having to
/// reach into tower-sessions' opaque storage.
pub const SESSION_KEY_PW_CHANGED_AT: &str = "pw_changed_at_unix";

/// Holds the user_id of a half-authenticated Google OAuth login that still
/// owes a TOTP challenge. Set by the Google callback when the account has 2FA
/// enabled; consumed by `/auth/google/verify-totp`, which swaps it for the
/// real [`SESSION_KEY_USER_ID`] once the code checks out. A request carrying
/// only this key is NOT authenticated — the `CurrentUser` extractor reads
/// [`SESSION_KEY_USER_ID`], never this — so no route is reachable mid-challenge.
pub const SESSION_KEY_PENDING_TOTP_USER: &str = "pending_totp_user_id";

/// Set when an admin is impersonating another user. Stores the admin's
/// real UUID so the session can be restored when impersonation ends.
pub const SESSION_KEY_REAL_USER_ID: &str = "real_user_id";
/// Companion to `SESSION_KEY_REAL_USER_ID`: stores the admin's
/// `password_changed_at` unix timestamp so the pw-version check passes
/// when we restore the admin's identity after stopping impersonation.
pub const SESSION_KEY_REAL_PW_CHANGED_AT: &str = "real_pw_changed_at_unix";

/// Extracted authenticated user. Returns 401 if there's no session or the
/// session points at a missing/non-active user.
pub struct CurrentUser(pub User);

impl<S> FromRequestParts<S> for CurrentUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|_| ApiError::Internal("session middleware missing".into()))?;
        let user_id: Option<Uuid> = session
            .get(SESSION_KEY_USER_ID)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        let user_id = user_id.ok_or(ApiError::Unauthorized)?;

        let app_state = AppState::from_ref(state);
        let user = zerovpn_db::repos::users::find_by_id(&app_state.pool, user_id)
            .await
            .map_err(ApiError::from)?
            .ok_or(ApiError::Unauthorized)?;

        if user.status != UserStatus::Active {
            return Err(ApiError::Forbidden);
        }

        // Password-version check. A session minted before the user's most
        // recent password change is dead — drop it. Sessions issued before
        // this check shipped won't have the key set; treat that as a
        // mismatch too so legacy sessions don't ride past a reset.
        let snap_unix: Option<i64> = session
            .get(SESSION_KEY_PW_CHANGED_AT)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        let snapshot = snap_unix
            .and_then(|s| OffsetDateTime::from_unix_timestamp(s).ok())
            .ok_or(ApiError::Unauthorized)?;
        // Truncate both sides to second resolution (snapshot is stored
        // as unix seconds) so we don't trip on sub-second drift.
        let live_secs = user.password_changed_at.unix_timestamp();
        if snapshot.unix_timestamp() != live_secs {
            return Err(ApiError::Unauthorized);
        }
        Ok(Self(user))
    }
}

/// Extracted authenticated admin user. Returns 403 for non-admins.
pub struct RequireAdmin(pub User);

impl<S> FromRequestParts<S> for RequireAdmin
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let CurrentUser(user) = CurrentUser::from_request_parts(parts, state).await?;
        if user.role != UserRole::Admin {
            return Err(ApiError::Forbidden);
        }
        Ok(Self(user))
    }
}
