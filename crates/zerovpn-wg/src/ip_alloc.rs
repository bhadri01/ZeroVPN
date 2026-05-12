use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use fixedbitset::FixedBitSet;
use ipnetwork::{IpNetwork, Ipv4Network, Ipv6Network};
use parking_lot::Mutex;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AllocError {
    #[error("subnet exhausted")]
    Exhausted,
    #[error("ip out of range")]
    OutOfRange,
    #[error("ip already allocated")]
    AlreadyAllocated,
    #[error("ip is reserved (network / broadcast / gateway)")]
    Reserved,
    #[error("ip family mismatch: allocator is {0}, ip is {1}")]
    FamilyMismatch(&'static str, &'static str),
}

/// In-memory allocator over a single server's CIDR. Supports both IPv4
/// and IPv6 via two backends:
///
/// - **V4** — bitmap (`FixedBitSet`), one bit per host. Pre-marks the
///   network, broadcast, and `.1` gateway as allocated. O(N) scan to
///   find the lowest free index; N caps at 2^(32 - prefix) so even a
///   /16 (~65k bits) is fine.
///
/// - **V6** — sparse `HashSet<Ipv6Addr>` plus a hint cursor. Bitmapping
///   a /64 (2^64 entries) is impossible, so we track only allocated
///   addresses and scan upward from a monotonic hint to find the next
///   free slot. The set's memory cost is proportional to the *number
///   of active peers*, not the subnet size. Reserves offset 0
///   (network) and offset 1 (gateway). No broadcast in IPv6.
///
/// Methods accept `IpAddr` and return `IpAddr`; a family mismatch
/// (passing a v6 address to a v4 allocator or vice-versa) returns
/// `AllocError::FamilyMismatch` rather than silently misbehaving.
pub enum IpAllocator {
    V4(V4Allocator),
    V6(V6Allocator),
}

pub struct V4Allocator {
    network: Ipv4Network,
    bits: Mutex<FixedBitSet>,
}

pub struct V6Allocator {
    network: Ipv6Network,
    /// Set of currently allocated offsets (relative to network address).
    /// We track *offsets* rather than full `Ipv6Addr`s so the set keys
    /// stay compact and we can cheaply compare to a u128 cursor.
    allocated: Mutex<HashSet<u128>>,
    /// Monotonic hint for the next-free scan. Bumped past every
    /// allocated offset we observe so `allocate()` is amortized O(1)
    /// in the common churn-free case.
    cursor: Mutex<u128>,
    /// Total addressable hosts, when it fits in a u128. `None` means
    /// "effectively infinite" (prefix < 0; in practice we never hit
    /// that, but the type captures intent). For prefixes 1..=127 the
    /// host count is `2^(128 - prefix)`, which always fits.
    total: Option<u128>,
}

impl IpAllocator {
    pub fn new(network: IpNetwork) -> Self {
        match network {
            IpNetwork::V4(v4) => IpAllocator::V4(V4Allocator::new(v4)),
            IpNetwork::V6(v6) => IpAllocator::V6(V6Allocator::new(v6)),
        }
    }

    pub fn allocate(&self) -> Result<IpAddr, AllocError> {
        match self {
            IpAllocator::V4(a) => a.allocate().map(IpAddr::V4),
            IpAllocator::V6(a) => a.allocate().map(IpAddr::V6),
        }
    }

    pub fn release(&self, ip: IpAddr) -> Result<(), AllocError> {
        match (self, ip) {
            (IpAllocator::V4(a), IpAddr::V4(v4)) => a.release(v4),
            (IpAllocator::V6(a), IpAddr::V6(v6)) => a.release(v6),
            (IpAllocator::V4(_), IpAddr::V6(_)) => {
                Err(AllocError::FamilyMismatch("v4", "v6"))
            }
            (IpAllocator::V6(_), IpAddr::V4(_)) => {
                Err(AllocError::FamilyMismatch("v6", "v4"))
            }
        }
    }

    pub fn mark_allocated(&self, ip: IpAddr) -> Result<(), AllocError> {
        match (self, ip) {
            (IpAllocator::V4(a), IpAddr::V4(v4)) => a.mark_allocated(v4),
            (IpAllocator::V6(a), IpAddr::V6(v6)) => a.mark_allocated(v6),
            (IpAllocator::V4(_), IpAddr::V6(_)) => {
                Err(AllocError::FamilyMismatch("v4", "v6"))
            }
            (IpAllocator::V6(_), IpAddr::V4(_)) => {
                Err(AllocError::FamilyMismatch("v6", "v4"))
            }
        }
    }

    pub fn try_reserve(&self, ip: IpAddr) -> Result<(), AllocError> {
        match (self, ip) {
            (IpAllocator::V4(a), IpAddr::V4(v4)) => a.try_reserve(v4),
            (IpAllocator::V6(a), IpAddr::V6(v6)) => a.try_reserve(v6),
            (IpAllocator::V4(_), IpAddr::V6(_)) => {
                Err(AllocError::FamilyMismatch("v4", "v6"))
            }
            (IpAllocator::V6(_), IpAddr::V4(_)) => {
                Err(AllocError::FamilyMismatch("v6", "v4"))
            }
        }
    }
}

impl V4Allocator {
    pub fn new(network: Ipv4Network) -> Self {
        let total = (1u64 << (32 - network.prefix())) as usize;
        let mut bits = FixedBitSet::with_capacity(total);
        // Mark network address (offset 0) and broadcast (last) as allocated.
        bits.insert(0);
        if total > 1 {
            bits.insert(total - 1);
        }
        // Convention: gateway at .1 is reserved for the server itself.
        if total > 2 {
            bits.insert(1);
        }
        Self { network, bits: Mutex::new(bits) }
    }

    pub fn mark_allocated(&self, ip: Ipv4Addr) -> Result<(), AllocError> {
        let idx = self.index_of(ip)?;
        self.bits.lock().insert(idx);
        Ok(())
    }

    pub fn allocate(&self) -> Result<Ipv4Addr, AllocError> {
        let mut bits = self.bits.lock();
        let total = bits.len();
        let mut idx = 0;
        while idx < total && bits.contains(idx) {
            idx += 1;
        }
        if idx >= total {
            return Err(AllocError::Exhausted);
        }
        bits.insert(idx);
        Ok(self.ip_at(idx))
    }

    pub fn release(&self, ip: Ipv4Addr) -> Result<(), AllocError> {
        let idx = self.index_of(ip)?;
        self.bits.lock().remove(idx);
        Ok(())
    }

    pub fn try_reserve(&self, ip: Ipv4Addr) -> Result<(), AllocError> {
        let idx = self.index_of(ip)?;
        let mut bits = self.bits.lock();
        let total = bits.len();
        if idx == 0 || idx == 1 || idx == total - 1 {
            return Err(AllocError::Reserved);
        }
        if bits.contains(idx) {
            return Err(AllocError::AlreadyAllocated);
        }
        bits.insert(idx);
        Ok(())
    }

    fn index_of(&self, ip: Ipv4Addr) -> Result<usize, AllocError> {
        if !self.network.contains(ip) {
            return Err(AllocError::OutOfRange);
        }
        let net = u32::from(self.network.network());
        let target = u32::from(ip);
        Ok((target - net) as usize)
    }

    fn ip_at(&self, idx: usize) -> Ipv4Addr {
        let net = u32::from(self.network.network());
        Ipv4Addr::from(net + idx as u32)
    }
}

impl V6Allocator {
    pub fn new(network: Ipv6Network) -> Self {
        let host_bits = 128 - u32::from(network.prefix());
        let total = if host_bits >= 128 {
            None
        } else {
            Some(1u128 << host_bits)
        };
        // Pre-reserve the network address and the gateway slot. IPv6
        // has no broadcast, so we don't reserve the last host.
        let mut allocated = HashSet::new();
        allocated.insert(0); // network
        if total.map(|t| t > 1).unwrap_or(true) {
            allocated.insert(1); // gateway
        }
        Self {
            network,
            allocated: Mutex::new(allocated),
            cursor: Mutex::new(2),
            total,
        }
    }

    pub fn mark_allocated(&self, ip: Ipv6Addr) -> Result<(), AllocError> {
        let offset = self.offset_of(ip)?;
        let mut set = self.allocated.lock();
        set.insert(offset);
        // Drag the cursor forward so we don't have to re-discover this
        // offset on the next allocate() scan.
        let mut cursor = self.cursor.lock();
        if offset >= *cursor {
            *cursor = offset.saturating_add(1);
        }
        Ok(())
    }

    pub fn allocate(&self) -> Result<Ipv6Addr, AllocError> {
        let mut set = self.allocated.lock();
        let mut cursor = self.cursor.lock();
        loop {
            if let Some(total) = self.total {
                if *cursor >= total {
                    return Err(AllocError::Exhausted);
                }
            }
            if !set.contains(&*cursor) {
                let offset = *cursor;
                set.insert(offset);
                *cursor = cursor.saturating_add(1);
                return Ok(self.ip_at(offset));
            }
            *cursor = cursor.saturating_add(1);
        }
    }

    pub fn release(&self, ip: Ipv6Addr) -> Result<(), AllocError> {
        let offset = self.offset_of(ip)?;
        let mut set = self.allocated.lock();
        if offset < 2 {
            // Don't let callers free reserved slots.
            return Err(AllocError::Reserved);
        }
        set.remove(&offset);
        // We don't roll the cursor back — released slots will be picked
        // up by future allocate() scans naturally, but only after the
        // cursor wraps which won't happen in any realistic v6 subnet.
        // Sparse reuse is acceptable; IPv6 host-space is enormous.
        Ok(())
    }

    pub fn try_reserve(&self, ip: Ipv6Addr) -> Result<(), AllocError> {
        let offset = self.offset_of(ip)?;
        if offset == 0 || offset == 1 {
            return Err(AllocError::Reserved);
        }
        let mut set = self.allocated.lock();
        if set.contains(&offset) {
            return Err(AllocError::AlreadyAllocated);
        }
        set.insert(offset);
        let mut cursor = self.cursor.lock();
        if offset >= *cursor {
            *cursor = offset.saturating_add(1);
        }
        Ok(())
    }

    fn offset_of(&self, ip: Ipv6Addr) -> Result<u128, AllocError> {
        if !self.network.contains(ip) {
            return Err(AllocError::OutOfRange);
        }
        let net = u128::from(self.network.network());
        let target = u128::from(ip);
        Ok(target - net)
    }

    fn ip_at(&self, offset: u128) -> Ipv6Addr {
        let net = u128::from(self.network.network());
        Ipv6Addr::from(net + offset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v4_allocates_from_low_to_high() {
        let alloc = IpAllocator::new("10.10.0.0/30".parse().unwrap());
        let first = alloc.allocate().unwrap();
        assert_eq!(first, "10.10.0.2".parse::<IpAddr>().unwrap());
        assert!(matches!(alloc.allocate(), Err(AllocError::Exhausted)));
    }

    #[test]
    fn v4_releases_and_re_allocates() {
        let alloc = IpAllocator::new("10.10.0.0/29".parse().unwrap());
        let a = alloc.allocate().unwrap();
        let b = alloc.allocate().unwrap();
        alloc.release(a).unwrap();
        let c = alloc.allocate().unwrap();
        assert_eq!(a, c);
        assert_ne!(b, c);
    }

    #[test]
    fn v6_allocates_starting_at_offset_two() {
        let alloc = IpAllocator::new("fd00::/64".parse().unwrap());
        let first = alloc.allocate().unwrap();
        assert_eq!(first, "fd00::2".parse::<IpAddr>().unwrap());
        let second = alloc.allocate().unwrap();
        assert_eq!(second, "fd00::3".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn v6_replay_via_mark_allocated_skips_used_offsets() {
        let alloc = IpAllocator::new("fd00::/64".parse().unwrap());
        alloc.mark_allocated("fd00::2".parse().unwrap()).unwrap();
        alloc.mark_allocated("fd00::3".parse().unwrap()).unwrap();
        let next = alloc.allocate().unwrap();
        assert_eq!(next, "fd00::4".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn v6_try_reserve_rejects_reserved_and_duplicates() {
        let alloc = IpAllocator::new("fd00::/64".parse().unwrap());
        assert!(matches!(
            alloc.try_reserve("fd00::1".parse().unwrap()),
            Err(AllocError::Reserved)
        ));
        alloc.try_reserve("fd00::100".parse().unwrap()).unwrap();
        assert!(matches!(
            alloc.try_reserve("fd00::100".parse().unwrap()),
            Err(AllocError::AlreadyAllocated)
        ));
    }

    #[test]
    fn v6_exhaustion_on_small_prefix() {
        // /126: 4 hosts. Offsets 0 (network) + 1 (gateway) reserved →
        // only 2 free slots.
        let alloc = IpAllocator::new("fd00::/126".parse().unwrap());
        let _a = alloc.allocate().unwrap();
        let _b = alloc.allocate().unwrap();
        assert!(matches!(alloc.allocate(), Err(AllocError::Exhausted)));
    }

    #[test]
    fn family_mismatch_is_reported() {
        let v4 = IpAllocator::new("10.10.0.0/24".parse().unwrap());
        let res = v4.try_reserve("fd00::2".parse().unwrap());
        assert!(matches!(res, Err(AllocError::FamilyMismatch(_, _))));
    }
}
