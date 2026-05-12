//! OpenAPI 3.1 spec served at `/openapi.json`.
//!
//! Pragmatic minimum: a hand-curated spec listing the public endpoints with
//! their methods + bodies. Full utoipa annotations on every route would
//! double the surface area; for v1 a single-file spec is good enough for
//! frontend codegen + Swagger UI consumption.

use axum::{Json, response::IntoResponse};
use serde_json::{Value, json};

pub async fn spec() -> impl IntoResponse {
    Json(build_spec())
}

fn build_spec() -> Value {
    let mut paths = serde_json::Map::new();

    // Auth
    add_path(
        &mut paths,
        "/ping",
        json!({ "get": { "summary": "Liveness ping", "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/auth/register",
        json!({ "post": { "summary": "Register account",
            "requestBody": body(&["email", "password"]),
            "responses": {"202": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/auth/login",
        json!({ "post": { "summary": "Sign in",
            "requestBody": body(&["email", "password", "totp_code"]),
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/auth/logout",
        json!({ "post": { "summary": "Sign out", "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/auth/verify-email",
        json!({ "post": { "summary": "Verify email with token",
            "requestBody": body(&["token"]),
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/auth/forgot-password",
        json!({ "post": { "summary": "Request password reset",
            "requestBody": body(&["email"]),
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/auth/reset-password",
        json!({ "post": { "summary": "Reset password with token",
            "requestBody": body(&["token", "new_password"]),
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/auth/totp/setup",
        json!({ "post": { "summary": "Begin 2FA enrollment", "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/auth/totp/enable",
        json!({ "post": { "summary": "Enable 2FA",
            "requestBody": body(&["secret", "code"]),
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/auth/totp/disable",
        json!({ "post": { "summary": "Disable 2FA",
            "requestBody": body(&["code"]),
            "responses": {"200": {"description": "ok"}} } }),
    );

    // Me
    add_path(
        &mut paths,
        "/me",
        json!({ "get": { "summary": "Current user", "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/me/data-export",
        json!({ "get": { "summary": "GDPR data export", "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/me/account",
        json!({ "delete": { "summary": "Soft-delete account", "responses": {"200": {"description": "ok"}} } }),
    );

    // Devices
    add_path(
        &mut paths,
        "/devices",
        json!({
            "get": { "summary": "List devices", "responses": {"200": {"description": "ok"}} },
            "post": { "summary": "Add device",
                "requestBody": body(&["name", "os"]),
                "responses": {"201": {"description": "created"}} }
        }),
    );
    add_path(
        &mut paths,
        "/devices/{id}",
        json!({
            "get": { "summary": "Device detail", "parameters": [path_id()], "responses": {"200": {"description": "ok"}} },
            "patch": { "summary": "Update device (split-tunnel + DNS overrides)",
                "parameters": [path_id()],
                "requestBody": body(&["name", "allowed_ips_override", "dns_override"]),
                "responses": {"200": {"description": "ok"}} },
            "delete": { "summary": "Revoke device", "parameters": [path_id()], "responses": {"200": {"description": "ok"}} }
        }),
    );
    add_path(
        &mut paths,
        "/devices/{id}/pause",
        json!({ "post": { "summary": "Pause device", "parameters": [path_id()], "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/devices/{id}/unpause",
        json!({ "post": { "summary": "Unpause device", "parameters": [path_id()], "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/devices/{id}/dns",
        json!({ "put": { "summary": "Set per-peer DNS hostnames",
            "parameters": [path_id()],
            "requestBody": body(&["dns_names"]),
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/devices/{id}/bandwidth",
        json!({ "get": { "summary": "Per-device bandwidth history",
            "parameters": [path_id(), q("range", "24h | 7d | 30d")],
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/bandwidth",
        json!({ "get": { "summary": "User-aggregate bandwidth history",
            "parameters": [q("range", "24h | 7d | 30d")],
            "responses": {"200": {"description": "ok"}} } }),
    );

    // Admin
    add_path(
        &mut paths,
        "/admin/users",
        json!({ "get": { "summary": "List users (admin)",
            "parameters": [q("q", "search"), q("limit", "page size"), q("offset", "page offset")],
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/admin/users/{id}/status",
        json!({ "put": { "summary": "Set user status (admin)",
            "parameters": [path_id()],
            "requestBody": body(&["status"]),
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/admin/users/{id}/quota",
        json!({ "put": { "summary": "Set user quota (admin)",
            "parameters": [path_id()],
            "requestBody": body(&["monthly_byte_cap"]),
            "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/admin/audit",
        json!({ "get": { "summary": "Audit log (admin)", "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/admin/audit.csv",
        json!({ "get": { "summary": "Audit log CSV (admin)", "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/admin/failed-logins",
        json!({ "get": { "summary": "Failed login attempts (admin)", "responses": {"200": {"description": "ok"}} } }),
    );
    add_path(
        &mut paths,
        "/admin/maintenance",
        json!({
            "get": { "summary": "Get maintenance state (admin)", "responses": {"200": {"description": "ok"}} },
            "put": { "summary": "Set maintenance state (admin)",
                "requestBody": body(&["maintenance_mode", "maintenance_message"]),
                "responses": {"200": {"description": "ok"}} }
        }),
    );
    // WS
    add_path(
        &mut paths,
        "/ws",
        json!({ "get": { "summary": "WebSocket upgrade for live events", "responses": {"101": {"description": "switching protocols"}} } }),
    );

    json!({
        "openapi": "3.1.0",
        "info": {
            "title": "ZeroVPN API",
            "version": env!("CARGO_PKG_VERSION"),
            "description": "Self-hosted WireGuard VPN management API."
        },
        "servers": [{ "url": "/api/v1" }],
        "paths": Value::Object(paths)
    })
}

fn add_path(paths: &mut serde_json::Map<String, Value>, path: &str, ops: Value) {
    paths.insert(path.to_string(), ops);
}

fn body(fields: &[&str]) -> Value {
    let props: serde_json::Map<String, Value> = fields
        .iter()
        .map(|f| (f.to_string(), json!({ "type": "string" })))
        .collect();
    json!({
        "required": true,
        "content": { "application/json": { "schema": { "type": "object", "properties": props } } }
    })
}

fn path_id() -> Value {
    json!({
        "name": "id", "in": "path", "required": true,
        "schema": { "type": "string", "format": "uuid" }
    })
}

fn q(name: &str, description: &str) -> Value {
    json!({
        "name": name, "in": "query", "required": false,
        "description": description,
        "schema": { "type": "string" }
    })
}
