//! HTTP middleware: maintenance-mode gate.

use axum::{
    body::Body,
    extract::State,
    http::{Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;
use tower_sessions::Session;

use crate::{extractors::auth::SESSION_KEY_USER_ID, state::AppState};

/// When `app_settings.maintenance_mode = TRUE`, return 503 for any
/// state-changing method (POST / PUT / PATCH / DELETE) unless the caller
/// is an admin. Reads keep working so the UI can still render.
pub async fn maintenance_gate(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let is_write = matches!(
        method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );
    if !is_write {
        return next.run(req).await;
    }
    let path = req.uri().path();
    // Auth + health endpoints stay open so admins can still log in.
    if path.starts_with("/api/v1/auth/") || path == "/health" || path == "/ready" {
        return next.run(req).await;
    }

    let on: Option<(bool,)> =
        sqlx::query_as("SELECT maintenance_mode FROM app_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    if !matches!(on, Some((true,))) {
        return next.run(req).await;
    }

    // Maintenance is ON. Try to identify the caller via the session
    // already attached by SessionManagerLayer.
    let session_opt = req.extensions().get::<Session>().cloned();
    if let Some(session) = session_opt {
        if let Ok(Some(user_id)) = session.get::<uuid::Uuid>(SESSION_KEY_USER_ID).await {
            if let Ok(Some(user)) =
                zerovpn_db::repos::users::find_by_id(&state.pool, user_id).await
            {
                if user.role == zerovpn_core::models::UserRole::Admin {
                    return next.run(req).await;
                }
            }
        }
    }

    let body = axum::Json(json!({
        "error": {
            "code": "maintenance",
            "message": "Service is in maintenance mode. Try again shortly.",
        }
    }));
    (StatusCode::SERVICE_UNAVAILABLE, body).into_response()
}
