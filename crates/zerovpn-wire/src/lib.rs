//! Shared wire schema for ZMQ pub/sub and WebSocket frames.
//!
//! Compiled to WASM for the frontend so backend and frontend share one source
//! of truth for message types. Use MessagePack (rmp-serde) on the wire.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Single envelope type for everything the worker publishes to the API and
/// the API forwards to the browser. Adding a new variant requires both ends
/// to be redeployed; never reuse a discriminant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Heartbeat from the worker; lets the API confirm the bus is alive.
    Heartbeat { ts_ms: i64 },

    /// Per-peer bandwidth delta (bytes since previous sample).
    StatsDelta {
        device_id: Uuid,
        user_id: Uuid,
        rx_bytes: u64,
        tx_bytes: u64,
        rate_rx_bps: u64,
        rate_tx_bps: u64,
        ts_ms: i64,
    },

    /// A peer's last_handshake timestamp moved.
    HandshakeChange {
        device_id: Uuid,
        user_id: Uuid,
        last_handshake_ms: i64,
    },

    /// A peer's status changed (paused/unpaused/revoked).
    PeerStatusChanged {
        device_id: Uuid,
        user_id: Uuid,
        status: PeerStatus,
    },

    /// DNS names for a peer changed.
    DnsUpdated {
        device_id: Uuid,
        user_id: Uuid,
        dns_names: Vec<String>,
    },

    /// Server-wide health snapshot.
    ServerHealth {
        server_id: Uuid,
        cpu_pct: f32,
        mem_used_bytes: u64,
        mem_total_bytes: u64,
        active_peers: u32,
        ts_ms: i64,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PeerStatus {
    Active,
    Paused,
    Revoked,
}

/// MessagePack-encode an event.
pub fn encode(event: &Event) -> Result<Vec<u8>, rmp_serde::encode::Error> {
    rmp_serde::to_vec_named(event)
}

/// MessagePack-decode an event.
pub fn decode(bytes: &[u8]) -> Result<Event, rmp_serde::decode::Error> {
    rmp_serde::from_slice(bytes)
}

// ---------------------------------------------------------------------------
// WASM bindings (only built when --features wasm)
// ---------------------------------------------------------------------------

#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn decode_frame(bytes: &[u8]) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
    let event = decode(bytes).map_err(|e| wasm_bindgen::JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&event).map_err(|e| wasm_bindgen::JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_roundtrip() {
        let e = Event::Heartbeat { ts_ms: 12345 };
        let bytes = encode(&e).unwrap();
        let decoded = decode(&bytes).unwrap();
        match decoded {
            Event::Heartbeat { ts_ms } => assert_eq!(ts_ms, 12345),
            _ => panic!("wrong variant"),
        }
    }
}
