use base64::{Engine as _, engine::general_purpose::STANDARD};
use rand::RngCore;

/// 32-byte WireGuard private key, base64-encoded.
pub fn generate_private_key() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    // Curve25519 clamping
    bytes[0] &= 248;
    bytes[31] &= 127;
    bytes[31] |= 64;
    STANDARD.encode(bytes)
}

/// Derive the public key from a base64 private key.
/// Implementation will use defguard_wireguard_rs::Key in the actual peer
/// management module; this stub returns an empty string until that wiring
/// lands in 1A.
pub fn derive_public_key(_private_key_b64: &str) -> String {
    // TODO: wire defguard_wireguard_rs::Key when control.rs is implemented
    String::new()
}

/// 32-byte preshared key, base64-encoded.
pub fn generate_preshared_key() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    STANDARD.encode(bytes)
}
