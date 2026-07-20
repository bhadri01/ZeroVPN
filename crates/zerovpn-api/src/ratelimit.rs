//! Small in-memory sliding-window rate limiter for the abuse-prone
//! unauthenticated endpoints — the ones that send mail (`register`,
//! `resend-verify`, `forgot-password`). Every hit on those costs a real
//! outbound email through the operator's SMTP relay, so they need both a
//! per-address and a per-client-IP ceiling.
//!
//! Per-process state is deliberate: the API is a single instance, and a
//! restart resetting the windows only ever fails open (allows a send),
//! never locks a legitimate user out. Login throttling is separate and
//! DB-backed (`failed_logins`) because it must survive restarts to blunt
//! credential stuffing; mail throttling has no such requirement.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Keys tracked before an opportunistic full sweep of stale entries. A
/// sweep is O(keys) under the lock, so it only runs when the map is big.
const SWEEP_THRESHOLD: usize = 10_000;

pub struct RateLimiter {
    max: usize,
    window: Duration,
    hits: Mutex<HashMap<String, Vec<Instant>>>,
}

impl RateLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            hits: Mutex::new(HashMap::new()),
        }
    }

    /// Record a hit for `key` and return whether it is within the limit.
    /// Over-limit hits are not recorded, so a blocked client's window
    /// still drains at the original rate instead of extending forever.
    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut map = self.hits.lock().expect("ratelimit mutex poisoned");
        if map.len() > SWEEP_THRESHOLD {
            let window = self.window;
            map.retain(|_, v| {
                v.retain(|t| now.duration_since(*t) < window);
                !v.is_empty()
            });
        }
        let v = map.entry(key.to_string()).or_default();
        v.retain(|t| now.duration_since(*t) < self.window);
        if v.len() >= self.max {
            return false;
        }
        v.push(now);
        true
    }
}

/// The two ceilings shared by every mail-sending endpoint. Shared (rather
/// than per-endpoint) on purpose: an attacker rotating between register /
/// resend / forgot for the same address or from the same IP burns one
/// combined budget, not three.
pub struct MailLimits {
    /// Sends per normalized email address.
    pub per_email: RateLimiter,
    /// Sends per client IP (all addresses combined).
    pub per_ip: RateLimiter,
}

impl Default for MailLimits {
    fn default() -> Self {
        Self {
            per_email: RateLimiter::new(3, Duration::from_secs(15 * 60)),
            per_ip: RateLimiter::new(10, Duration::from_secs(60 * 60)),
        }
    }
}

impl MailLimits {
    /// Gate a mail-sending request. `email` must already be normalized
    /// (trimmed + lowercased). A missing client IP (no XFF, direct dev
    /// call) skips the IP ceiling rather than collapsing every such
    /// client into one shared bucket.
    pub fn check(&self, email: &str, ip: Option<ipnetwork::IpNetwork>) -> bool {
        let email_ok = self.per_email.check(email);
        let ip_ok = match ip {
            Some(ip) => self.per_ip.check(&ip.ip().to_string()),
            None => true,
        };
        email_ok && ip_ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_max_and_recovers() {
        let rl = RateLimiter::new(2, Duration::from_millis(50));
        assert!(rl.check("k"));
        assert!(rl.check("k"));
        assert!(!rl.check("k"));
        std::thread::sleep(Duration::from_millis(60));
        assert!(rl.check("k"));
    }

    #[test]
    fn keys_are_independent() {
        let rl = RateLimiter::new(1, Duration::from_secs(60));
        assert!(rl.check("a"));
        assert!(rl.check("b"));
        assert!(!rl.check("a"));
    }
}
