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
        /// Authoritative cumulative lifetime totals for this device, after
        /// folding in this tick's delta. Lets the client display a "Total"
        /// that grows in real time and matches the server exactly, instead
        /// of accumulating deltas locally (which drifts on dropped frames).
        total_rx_bytes: u64,
        total_tx_bytes: u64,
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

    /// Server-wide health snapshot. Emitted by the worker every 5 s for
    /// admin dashboards. CPU%, memory, disk I/O ("real I/O"), network I/O,
    /// uptime, peer count. All rates are per-second (computed by the
    /// emitter from cumulative counters). Disk I/O is sourced from
    /// `/proc/diskstats` on Linux and is 0 on platforms where that file
    /// doesn't exist.
    ServerHealth {
        server_id: Uuid,
        cpu_pct: f32,
        mem_used_bytes: u64,
        mem_total_bytes: u64,
        active_peers: u32,
        /// Disk: bytes read per second, host-wide, across all real block
        /// devices (`/proc/diskstats`, filtered to skip loop/ram/dm).
        disk_read_bps: u64,
        /// Disk: bytes written per second, same source.
        disk_write_bps: u64,
        /// Network: bytes received per second (host-level, summed across NICs).
        net_rx_bps: u64,
        /// Network: bytes transmitted per second.
        net_tx_bps: u64,
        /// Process uptime in seconds (the worker's own — used in the
        /// "uptime dd hh mm ss" sidebar label).
        uptime_sec: u64,
        ts_ms: i64,
    },

    /// Per-server bandwidth + peer-count tick. Emitted once per poll
    /// round alongside the per-peer `StatsDelta`s. Backed by the
    /// `server_samples` table (migration 5).
    ServerSample {
        server_id: Uuid,
        total_rx_bytes: u64,
        total_tx_bytes: u64,
        rate_rx_bps: u64,
        rate_tx_bps: u64,
        peer_count: u32,
        online_count: u32,
        handshake_count: u32,
        ts_ms: i64,
    },

    /// A mutation happened to persisted data — emitted by the **API** (not
    /// the worker) straight onto the broadcast bus so every other session of
    /// the same user, plus any admin watching, can invalidate the relevant
    /// query and reflect the change in real time. The client maps
    /// `resource` to the cache keys it must refresh and may surface a toast
    /// keyed on `action`.
    ///
    /// `user_id` is the owning user for user-scoped resources (device, user
    /// account); `None` marks admin-global resources (server, maintenance)
    /// that only admins should react to. `id` is the affected row's id when
    /// a single row changed (`None` for bulk operations like reorder).
    DataChanged {
        user_id: Option<Uuid>,
        resource: ResourceKind,
        id: Option<Uuid>,
        action: ChangeAction,
    },
}

/// What kind of persisted resource a [`Event::DataChanged`] refers to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Device,
    User,
    Server,
    Maintenance,
}

/// The mutation that produced a [`Event::DataChanged`]. Used purely on the
/// client for optional toasts; the cache invalidation only keys on
/// `resource`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeAction {
    Created,
    Updated,
    Deleted,
    Paused,
    Unpaused,
    KeysRotated,
    DnsUpdated,
    Reordered,
    Connected,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PeerStatus {
    Active,
    Paused,
    Revoked,
}

/// MessagePack-encode an event.
///
/// Two non-defaults are set on the rmp-serde serializer:
///   - `with_struct_map()` — equivalent to the old `to_vec_named`: encode
///     struct fields by name (a map), not positionally (an array). Lets
///     the JS side decode without a shared schema.
///   - `with_human_readable()` — tells UUID / IpAddr-style types whose
///     serde impl branches on `is_human_readable()` to emit strings, not
///     raw bytes. Without this, `Uuid` lands on the wire as 16 raw bytes
///     and JS sees a Uint8Array (which stringifies to "1,158,0,168…").
pub fn encode(event: &Event) -> Result<Vec<u8>, rmp_serde::encode::Error> {
    let mut buf = Vec::new();
    let mut ser = rmp_serde::Serializer::new(&mut buf)
        .with_struct_map()
        .with_human_readable();
    event.serialize(&mut ser)?;
    Ok(buf)
}

/// MessagePack-decode an event. Mirrors the human-readable flag set on
/// the encode side so a round-trip in Rust still works.
pub fn decode(bytes: &[u8]) -> Result<Event, rmp_serde::decode::Error> {
    let mut de = rmp_serde::Deserializer::new(bytes).with_human_readable();
    Event::deserialize(&mut de)
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
