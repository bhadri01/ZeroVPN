use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::Serialize;
use sqlx::Row;
use utoipa::ToSchema;

use crate::state::AppState;

#[derive(Serialize, ToSchema)]
pub struct HealthBody {
    pub status: &'static str,
    pub version: &'static str,
}

#[derive(Serialize, ToSchema)]
pub struct ReadyBody {
    pub ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

#[derive(Serialize, ToSchema)]
pub struct PingBody {
    pub pong: bool,
    pub ts_ms: i64,
}

#[utoipa::path(
    get,
    path = "/health",
    tag = "Health",
    responses(
        (status = 200, description = "Liveness probe — process is up", body = HealthBody),
    ),
)]
pub async fn health() -> impl IntoResponse {
    Json(HealthBody { status: "ok", version: env!("CARGO_PKG_VERSION") })
}

#[utoipa::path(
    get,
    path = "/ready",
    tag = "Health",
    responses(
        (status = 200, description = "DB reachable", body = ReadyBody),
        (status = 503, description = "DB unreachable", body = ReadyBody),
    ),
)]
pub async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").fetch_one(&state.pool).await {
        Ok(row) => {
            let _: i32 = row.get(0);
            (StatusCode::OK, Json(ReadyBody { ready: true, reason: None })).into_response()
        }
        Err(e) => {
            tracing::error!(?e, "db not ready");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ReadyBody { ready: false, reason: Some("db") }),
            )
                .into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/ping",
    tag = "Health",
    responses(
        (status = 200, description = "Authenticated-aware liveness echo", body = PingBody),
    ),
)]
pub async fn ping() -> impl IntoResponse {
    Json(PingBody {
        pong: true,
        ts_ms: (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64,
    })
}
