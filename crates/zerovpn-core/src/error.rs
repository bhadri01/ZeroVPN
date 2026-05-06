use thiserror::Error;

pub type Result<T, E = Error> = core::result::Result<T, E>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("not found: {0}")]
    NotFound(&'static str),

    #[error("validation: {0}")]
    Validation(String),

    #[error("conflict: {0}")]
    Conflict(&'static str),

    #[error("forbidden")]
    Forbidden,

    #[error("unauthorized")]
    Unauthorized,

    #[error("rate limited")]
    RateLimited,

    #[error("internal: {0}")]
    Internal(String),
}
