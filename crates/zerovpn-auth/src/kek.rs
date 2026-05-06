//! AES-GCM wrapper for column-level secrets at rest (TOTP secrets,
//! WG pre-shared keys, etc.).
//!
//! The KEK (key encryption key) is a 32-byte secret loaded once from the
//! `ZEROVPN_KEK` env var (base64). On each encryption a fresh 12-byte
//! nonce is generated and prepended to the ciphertext.

use aes_gcm::{
    Aes256Gcm, Key, Nonce,
    aead::{Aead, KeyInit, OsRng, rand_core::RngCore},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum KekError {
    #[error("invalid kek: must be 32 bytes (base64)")]
    InvalidKek,
    #[error("base64: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("aead: {0}")]
    Aead(String),
    #[error("ciphertext too short")]
    Short,
}

pub struct Kek(Aes256Gcm);

impl Kek {
    pub fn from_b64(b64: &str) -> Result<Self, KekError> {
        let bytes = STANDARD.decode(b64)?;
        if bytes.len() != 32 {
            return Err(KekError::InvalidKek);
        }
        let key = Key::<Aes256Gcm>::from_slice(&bytes);
        Ok(Self(Aes256Gcm::new(key)))
    }

    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, KekError> {
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = self
            .0
            .encrypt(nonce, plaintext)
            .map_err(|e| KekError::Aead(e.to_string()))?;
        let mut out = Vec::with_capacity(12 + ct.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ct);
        Ok(out)
    }

    pub fn decrypt(&self, payload: &[u8]) -> Result<Vec<u8>, KekError> {
        if payload.len() < 12 {
            return Err(KekError::Short);
        }
        let (nonce_bytes, ct) = payload.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);
        self.0
            .decrypt(nonce, ct)
            .map_err(|e| KekError::Aead(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_kek() -> Kek {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let b64 = STANDARD.encode(bytes);
        Kek::from_b64(&b64).unwrap()
    }

    #[test]
    fn roundtrip() {
        let k = fresh_kek();
        let pt = b"super secret 2fa secret";
        let ct = k.encrypt(pt).unwrap();
        let pt2 = k.decrypt(&ct).unwrap();
        assert_eq!(pt, &pt2[..]);
    }

    #[test]
    fn each_encrypt_uses_fresh_nonce() {
        let k = fresh_kek();
        let pt = b"abc";
        let ct1 = k.encrypt(pt).unwrap();
        let ct2 = k.encrypt(pt).unwrap();
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn rejects_invalid_kek_length() {
        // 16 bytes = 128 bits — too short for AES-256.
        let bad = STANDARD.encode([0u8; 16]);
        assert!(matches!(Kek::from_b64(&bad), Err(KekError::InvalidKek)));
    }
}
