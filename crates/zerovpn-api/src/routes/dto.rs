//! Shared DTOs used by multiple route modules + the OpenAPI aggregator.
//!
//! Most request/response types live next to the handler that owns them
//! (in `auth.rs`, `devices.rs`, etc.). The few shapes in here are the
//! ones that appear in many places — e.g. `StatusAck`, the
//! `{"status": "ok"}` payload returned by every fire-and-forget POST
//! — and lifting them out keeps each route file shorter.

use serde::Serialize;
use utoipa::ToSchema;

/// Generic acknowledgement returned by side-effect-only endpoints
/// (logout, revoke, set-quota, etc.) when there's nothing meaningful
/// to put in the body. The string is always `"ok"` on success.
#[derive(Debug, Serialize, ToSchema)]
pub struct StatusAck {
    #[schema(example = "ok")]
    pub status: &'static str,
}
