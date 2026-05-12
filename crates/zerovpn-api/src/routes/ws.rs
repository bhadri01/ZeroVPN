use axum::{
    extract::{State, WebSocketUpgrade, ws::{Message, WebSocket}},
    response::IntoResponse,
};
use tokio::sync::broadcast;
use tracing::{debug, info, warn};
use uuid::Uuid;
use zerovpn_core::models::UserRole;
use zerovpn_wire::Event;

use crate::{
    error::{ApiError, ApiResult},
    extractors::auth::CurrentUser,
    state::AppState,
};

/// Maximum number of events the broadcast channel buffers per subscriber
/// before lagging consumers drop frames. Live stats are recoverable on next
/// poll, so 64 is plenty.
pub const BROADCAST_BUFFER: usize = 64;

pub async fn ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    let rx = state.events.subscribe();
    Ok(ws.on_upgrade(move |socket| async move {
        run(socket, rx, user.id, user.role).await;
    }))
}

async fn run(mut socket: WebSocket, mut rx: broadcast::Receiver<Event>, user_id: Uuid, role: UserRole) {
    info!(%user_id, ?role, "ws client connected");
    loop {
        tokio::select! {
            // Inbound from client (we ignore data; just keep reading so the
            // socket stays open and detect close/ping).
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => {
                        debug!(%user_id, "ws client closed");
                        break;
                    }
                    Some(Ok(Message::Ping(p))) => {
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    Some(Ok(_)) => {} // ignore text/binary/pong
                    Some(Err(e)) => {
                        warn!(%user_id, ?e, "ws recv error");
                        break;
                    }
                }
            }

            // Outbound from broadcast.
            ev = rx.recv() => {
                match ev {
                    Ok(event) => {
                        if !visible_to(&event, user_id, role) { continue; }
                        match zerovpn_wire::encode(&event) {
                            Ok(bytes) => {
                                if socket.send(Message::Binary(bytes.into())).await.is_err() {
                                    debug!(%user_id, "ws send failed; client gone");
                                    break;
                                }
                            }
                            Err(e) => warn!(?e, "encode event"),
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!(%user_id, lagged = n, "ws subscriber lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    info!(%user_id, "ws client disconnected");
}

/// Filter: regular users see only their own events; admins see everything.
fn visible_to(event: &Event, user_id: Uuid, role: UserRole) -> bool {
    if role == UserRole::Admin {
        return true;
    }
    match event {
        // Host health (CPU / mem / I/O) feeds the sidebar status panel for
        // every user, so it's not admin-gated. Heartbeat and per-WG-server
        // samples remain admin-only.
        Event::ServerHealth { .. } => true,
        Event::Heartbeat { .. } | Event::ServerSample { .. } => false,
        Event::StatsDelta { user_id: u, .. }
        | Event::HandshakeChange { user_id: u, .. }
        | Event::PeerStatusChanged { user_id: u, .. }
        | Event::DnsUpdated { user_id: u, .. } => *u == user_id,
    }
}
