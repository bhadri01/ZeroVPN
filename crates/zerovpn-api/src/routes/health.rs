use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::Serialize;
use sqlx::Row;

use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthBody {
    pub status: &'static str,
    pub version: &'static str,
}

pub async fn health() -> impl IntoResponse {
    Json(HealthBody { status: "ok", version: env!("CARGO_PKG_VERSION") })
}

pub async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").fetch_one(&state.pool).await {
        Ok(row) => {
            let _: i32 = row.get(0);
            (StatusCode::OK, Json(serde_json::json!({ "ready": true }))).into_response()
        }
        Err(e) => {
            tracing::error!(?e, "db not ready");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "ready": false, "reason": "db" })),
            )
                .into_response()
        }
    }
}

pub async fn ping() -> impl IntoResponse {
    Json(serde_json::json!({
        "pong": true,
        "ts_ms": time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000,
    }))
}
