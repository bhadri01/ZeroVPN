//! WireGuard control: keypair generation, IP allocation, peer add/remove,
//! `.conf` rendering, QR rendering. (Device pause/unpause — remove the peer
//! from the running interface and restore it — lives in the api at
//! `routes::devices`, since it needs the DB row + IP allocation kept.)
//!
//! Uses `defguard_wireguard_rs` for UAPI/netlink access, with a parking_lot
//! Mutex over an in-memory IP allocation bitmap for race-free allocations.

pub mod config;
pub mod control;
pub mod ip_alloc;
pub mod keys;
pub mod qr;

pub use control::{ControlError, NoopController, ShellController, WgController};
#[cfg(target_os = "linux")]
pub use control::KernelController;
