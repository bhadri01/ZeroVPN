use argon2::{
    Algorithm, Argon2, Params, PasswordHash, PasswordHasher, PasswordVerifier, Version,
    password_hash::{SaltString, rand_core::OsRng},
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HashError {
    #[error("argon2: {0}")]
    Argon2(String),
}

fn argon2() -> Argon2<'static> {
    // m=64 MiB, t=3, p=4 — matches the plan
    let params = Params::new(65536, 3, 4, None).expect("valid argon2 params");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

pub fn hash(plaintext: &str) -> Result<String, HashError> {
    let salt = SaltString::generate(&mut OsRng);
    argon2()
        .hash_password(plaintext.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| HashError::Argon2(e.to_string()))
}

pub fn verify(plaintext: &str, hash: &str) -> Result<bool, HashError> {
    let parsed = PasswordHash::new(hash).map_err(|e| HashError::Argon2(e.to_string()))?;
    Ok(argon2().verify_password(plaintext.as_bytes(), &parsed).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let h = hash("correct horse battery staple").unwrap();
        assert!(verify("correct horse battery staple", &h).unwrap());
        assert!(!verify("wrong password", &h).unwrap());
    }
}
