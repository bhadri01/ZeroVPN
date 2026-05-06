//! Transactional email via SMTP (lettre).
//!
//! Templates live in this crate so they're reusable across api & worker.

pub mod templates;
pub mod transport;

pub use transport::Mailer;
