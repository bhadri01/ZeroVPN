//! Domain types, errors, and config shared across all ZeroVPN crates.
//!
//! This crate has zero dependencies on web/db/runtime crates so the domain
//! model stays pure and testable.

pub mod config;
pub mod error;
pub mod ids;

pub use error::{Error, Result};
