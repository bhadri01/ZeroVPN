use std::net::Ipv4Addr;

use fixedbitset::FixedBitSet;
use ipnetwork::Ipv4Network;
use parking_lot::Mutex;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AllocError {
    #[error("subnet exhausted")]
    Exhausted,
    #[error("ip out of range")]
    OutOfRange,
}

/// In-memory bitmap of allocated IPs within a server's CIDR.
///
/// One bit per usable host. Bit cleared = free, set = allocated.
/// Network and broadcast addresses are pre-marked as allocated.
pub struct IpAllocator {
    network: Ipv4Network,
    bits: Mutex<FixedBitSet>,
}

impl IpAllocator {
    pub fn new(network: Ipv4Network) -> Self {
        let total = (1u32 << (32 - network.prefix())) as usize;
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

    /// Replay existing allocations after boot from the DB.
    pub fn mark_allocated(&self, ip: Ipv4Addr) -> Result<(), AllocError> {
        let idx = self.index_of(ip)?;
        self.bits.lock().insert(idx);
        Ok(())
    }

    /// Find the lowest free address and mark it allocated.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocates_from_low_to_high() {
        let net: Ipv4Network = "10.10.0.0/30".parse().unwrap();
        let alloc = IpAllocator::new(net);
        // /30 has 4 addresses: .0 (network), .1 (gateway, reserved), .2, .3 (broadcast)
        // Only .2 is free.
        let first = alloc.allocate().unwrap();
        assert_eq!(first, "10.10.0.2".parse::<Ipv4Addr>().unwrap());
        // No more space.
        assert!(matches!(alloc.allocate(), Err(AllocError::Exhausted)));
    }

    #[test]
    fn releases_and_re_allocates() {
        let net: Ipv4Network = "10.10.0.0/29".parse().unwrap();
        let alloc = IpAllocator::new(net);
        let a = alloc.allocate().unwrap();
        let b = alloc.allocate().unwrap();
        alloc.release(a).unwrap();
        let c = alloc.allocate().unwrap();
        assert_eq!(a, c);
        assert_ne!(b, c);
    }
}
