//! HTTP middleware: maintenance-mode gate + per-request access log.

use std::time::Instant;

use axum::{
    body::Body,
    extract::State,
    http::{HeaderMap, Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;
use tower_sessions::Session;
use tracing::warn;

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

// ── access_log ──────────────────────────────────────────────────────
//
// One row in `access_logs` per request. Wrapped in a layer attached
// AFTER `SessionManagerLayer` and `SetRequestIdLayer` in the tower
// stack (see main.rs) so we can read the session + request-id header
// inline. Skips a small noise list (health probes, the frontend
// heartbeat, the long-lived WS upgrade) to keep the table from being
// flooded by infrastructure traffic.
//
// Write strategy: tokio::spawn so the INSERT doesn't block the
// response. If the spawn'd task errors, we log at warn — the response
// has already been sent to the client.

/// Paths that should NOT produce an access_log row. Match by exact
/// path or, for WS, by prefix.
fn skip_path(path: &str) -> bool {
    matches!(
        path,
        "/health" | "/ready" | "/metrics" | "/openapi.json" | "/api/v1/ping"
    ) || path.starts_with("/api/v1/ws")
}

/// Best-effort full client IP from `X-Forwarded-For` / `X-Real-IP`.
/// Mirrors the helper in `routes/auth.rs` (kept duplicated here so
/// middleware doesn't depend on routes).
fn client_ip(headers: &HeaderMap) -> Option<ipnetwork::IpNetwork> {
    let raw = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())?;
    let first = raw.split(',').next()?.trim();
    let ip: std::net::IpAddr = first.parse().ok()?;
    Some(ipnetwork::IpNetwork::from(ip))
}

fn client_user_agent(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(axum::http::header::USER_AGENT)?.to_str().ok()?.trim();
    if raw.is_empty() { None } else { Some(raw.to_string()) }
}

fn request_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

pub async fn access_log(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let path = req.uri().path().to_owned();
    if skip_path(&path) {
        return next.run(req).await;
    }
    let method = req.method().as_str().to_owned();
    let ip = client_ip(req.headers());
    let ua = client_user_agent(req.headers());
    let rid = request_id(req.headers());

    // Resolve user_id from the attached session, if any. Read before
    // we move the request into `next.run(...)`. `Session::get` is async
    // — adds one extra await per logged request, acceptable for the
    // observability win.
    let user_id: Option<uuid::Uuid> = match req.extensions().get::<Session>().cloned() {
        Some(s) => s.get(SESSION_KEY_USER_ID).await.ok().flatten(),
        None => None,
    };

    let start = Instant::now();
    let response = next.run(req).await;
    let latency_ms = start.elapsed().as_millis().min(i32::MAX as u128) as i32;
    let status = response.status().as_u16() as i16;

    // Fire-and-forget insert. The response is already on its way back
    // to the client; we don't want a DB hiccup to delay it.
    let pool = state.pool.clone();
    tokio::spawn(async move {
        let entry = zerovpn_db::repos::access_logs::AccessLogEntry {
            user_id,
            method: &method,
            path: &path,
            status,
            latency_ms,
            ip,
            user_agent: ua.as_deref(),
            request_id: rid.as_deref(),
        };
        if let Err(e) = zerovpn_db::repos::access_logs::record(&pool, entry).await {
            warn!(?e, path = %path, "access_log insert failed");
        }
    });

    response
}
