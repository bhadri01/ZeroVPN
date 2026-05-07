use std::sync::Arc;

use tokio::sync::broadcast;
use zerovpn_db::PgPool;
use zerovpn_wg::ip_alloc::IpAllocator;
use zerovpn_wire::Event;

use crate::routes::ws::BROADCAST_BUFFER;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// Per-server IP allocator, keyed by server UUID.
    pub allocators: Arc<IpAllocators>,
    /// Broadcast bus into which the ZMQ subscriber writes events.
    /// WebSocket clients subscribe and filter to events that concern them.
    pub events: broadcast::Sender<Event>,
}

impl AppState {
    pub fn new(pool: PgPool, allocators: Arc<IpAllocators>) -> Self {
        let (events, _) = broadcast::channel::<Event>(BROADCAST_BUFFER);
        Self { pool, allocators, events }
    }
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
