//! ZeroMQ pub/sub bus for real-time events.
//!
//! - Publisher binds (used by the worker).
//! - Subscriber connects (used by the API).
//! - All payloads are MessagePack-encoded `zerovpn_wire::Event`.

pub mod publisher;
pub mod subscriber;

pub use publisher::Publisher;
pub use subscriber::Subscriber;
