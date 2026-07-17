//! WireGuard X25519 keypair helpers.
//!
//! WG uses Curve25519 ECDH: a 32-byte private key (clamped per RFC 7748) and
//! the corresponding public key derived via scalar multiplication with the
//! basepoint. We use `x25519-dalek` which handles clamping and basepoint mul
//! correctly.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use rand::RngCore;
use x25519_dalek::{PublicKey, StaticSecret};

/// Generate a new private key, base64-encoded (44 chars including the
/// trailing `=`). The static-secret constructor clamps the bits per RFC 7748.
pub fn generate_private_key() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let secret = StaticSecret::from(bytes);
    STANDARD.encode(secret.to_bytes())
}

/// Derive the corresponding public key from a base64 private key.
pub fn derive_public_key(private_key_b64: &str) -> Result<String, KeyError> {
    let bytes = STANDARD.decode(private_key_b64).map_err(|_| KeyError::Base64)?;
    let array: [u8; 32] = bytes.try_into().map_err(|_| KeyError::Length)?;
    let secret = StaticSecret::from(array);
    let public = PublicKey::from(&secret);
    Ok(STANDARD.encode(public.to_bytes()))
}

#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    #[error("invalid base64 in key")]
    Base64,
    #[error("key length must be 32 bytes")]
    Length,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keypair_roundtrip() {
        let priv_a = generate_private_key();
        let pub_a = derive_public_key(&priv_a).unwrap();
        // Decoding to bytes should yield exactly 32 each.
        assert_eq!(STANDARD.decode(&priv_a).unwrap().len(), 32);
        assert_eq!(STANDARD.decode(&pub_a).unwrap().len(), 32);

        // Same private key always derives the same public key.
        let pub_a2 = derive_public_key(&priv_a).unwrap();
        assert_eq!(pub_a, pub_a2);

        // Different private keys produce different public keys.
        let priv_b = generate_private_key();
        let pub_b = derive_public_key(&priv_b).unwrap();
        assert_ne!(pub_a, pub_b);
    }

    #[test]
    fn rejects_short_key() {
        let bad = STANDARD.encode([0u8; 8]);
        assert!(derive_public_key(&bad).is_err());
    }
}
