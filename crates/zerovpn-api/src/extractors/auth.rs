use axum::{
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use tower_sessions::Session;
use uuid::Uuid;
use zerovpn_core::models::{User, UserRole, UserStatus};

use crate::{error::ApiError, state::AppState};

pub const SESSION_KEY_USER_ID: &str = "user_id";

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
