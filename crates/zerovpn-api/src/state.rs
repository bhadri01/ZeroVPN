use std::sync::Arc;

use zerovpn_db::PgPool;
use zerovpn_wg::ip_alloc::IpAllocator;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// Per-server IP allocator, keyed by server UUID stringified.
    /// Loaded on startup and updated on every device create/revoke.
    pub allocators: Arc<IpAllocators>,
}

#[derive(Default)]
pub struct IpAllocators {
    pub map: parking_lot::RwLock<std::collections::HashMap<uuid::Uuid, Arc<IpAllocator>>>,
}

impl IpAllocators {
    pub fn get(&self, server_id: uuid::Uuid) -> Option<Arc<IpAllocator>> {
        self.map.read().get(&server_id).cloned()
    }

    pub fn insert(&self, server_id: uuid::Uuid, alloc: Arc<IpAllocator>) {
        self.map.write().insert(server_id, alloc);
    }
}
