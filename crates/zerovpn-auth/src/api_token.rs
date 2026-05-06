//! Opaque API tokens.
//!
//! Tokens are 32 bytes URL-safe base64 (~43 chars). Hashed at rest using
//! sha256. Shown to the user plaintext exactly once on creation.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Generate a new opaque token. Return (plaintext, hash).
pub fn generate() -> (String, String) {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let plaintext = URL_SAFE_NO_PAD.encode(bytes);
    let hash = hash(&plaintext);
    (plaintext, hash)
}

/// Hash a plaintext token for storage / comparison.
pub fn hash(plaintext: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(plaintext.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_unique_tokens() {
        let (p1, h1) = generate();
        let (p2, h2) = generate();
        assert_ne!(p1, p2);
        assert_ne!(h1, h2);
        assert_eq!(p1.len(), 43); // base64 url-safe of 32 bytes, no padding
        assert_eq!(h1.len(), 64); // sha256 hex
    }

    #[test]
    fn hash_is_deterministic() {
        let (p, h) = generate();
        assert_eq!(hash(&p), h);
    }
}
