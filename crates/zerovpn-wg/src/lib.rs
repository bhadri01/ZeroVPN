//! WireGuard control: keypair generation, IP allocation, peer add/remove,
//! pause/unpause, `.conf` rendering, QR rendering.
//!
//! Uses `defguard_wireguard_rs` for UAPI/netlink access, with a parking_lot
//! Mutex over an in-memory IP allocation bitmap for race-free allocations.

pub mod config;
pub mod control;
pub mod ip_alloc;
pub mod keys;
pub mod pause;
pub mod qr;
