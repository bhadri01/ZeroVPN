//! AmneziaWG obfuscation parameter generation.
//!
//! Per-peer randomized values for Sc/Sr/H1–H4/Jc/Jmin/Jmax/S1/S2 fields, which
//! AmneziaWG uses to disguise WireGuard's recognizable handshake pattern.

use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AmneziaParams {
    pub jc: u8,
    pub jmin: u16,
    pub jmax: u16,
    pub s1: u16,
    pub s2: u16,
    pub h1: u32,
    pub h2: u32,
    pub h3: u32,
    pub h4: u32,
}

impl AmneziaParams {
    /// Generates a fresh, randomized parameter set within the recommended
    /// ranges from the AmneziaWG documentation.
    pub fn random() -> Self {
        let mut rng = rand::thread_rng();
        let jmin: u16 = rng.gen_range(50..200);
        let jmax: u16 = rng.gen_range(jmin + 1..1000);
        Self {
            jc: rng.gen_range(3..10),
            jmin,
            jmax,
            s1: rng.gen_range(15..150),
            s2: rng.gen_range(15..150),
            h1: rng.gen_range(5..u32::MAX),
            h2: rng.gen_range(5..u32::MAX),
            h3: rng.gen_range(5..u32::MAX),
            h4: rng.gen_range(5..u32::MAX),
        }
    }
}
