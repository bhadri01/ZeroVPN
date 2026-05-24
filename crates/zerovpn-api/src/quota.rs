//! Periodic quota-enforcement sweep.
//!
//! The worker only *measures* usage (folding each tick into the per-user and
//! per-device monthly counters). Enforcement lives here, in the API, because
//! the API owns the WireGuard controller (`state.wg`). Once a minute the sweep:
//!
//!   1. resets any monthly window whose boundary has passed,
//!   2. auto-resumes devices it had paused that are now back under both caps,
//!   3. auto-pauses active devices that are over their own cap or the account
//!      cap — whichever hits first.
//!
//! Pause/resume mark `devices.auto_paused` so a user's *manual* pause is never
//! disturbed by the reset sweep. Every action is best-effort: WG drift is
//! tolerated (the bootstrap reconciler converges it), and the DB row is the
//! source of truth.

use std::time::Duration;

use tracing::{info, warn};
use zerovpn_db::repos::{quota, users};
use zerovpn_wire::{ChangeAction, Event, NotifyLevel, PeerStatus, ResourceKind};

use crate::routes::devices::PERSISTENT_KEEPALIVE;
use crate::state::AppState;

/// How often the sweep runs. A minute is well within the worker's per-tick
/// counter cadence, so enforcement reacts within ~60s of a cap being crossed
/// without hammering the DB.
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// Spawn the background sweep. Call once at startup after `AppState` is built.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
        // First tick fires immediately; skip-then-loop so we don't sweep before
        // the rest of startup (peer reconcile) has settled.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(e) = run_once(&state).await {
                warn!(?e, "quota sweep failed");
            }
        }
    });
}

async fn run_once(state: &AppState) -> sqlx::Result<()> {
    let now = time::OffsetDateTime::now_utc();
    let next = users::first_of_next_month(now);

    // 1. Reset elapsed monthly windows so the under-cap checks below see the
    //    fresh (zeroed) counters.
    let u = quota::reset_due_users(&state.pool, now, next).await?;
    let d = quota::reset_due_devices(&state.pool, now, next).await?;
    if u > 0 || d > 0 {
        info!(users = u, devices = d, "quota windows reset");
    }

    // 2. Resume devices previously auto-paused that are now under both caps.
    for dev in quota::resume_candidates(&state.pool).await? {
        if quota::mark_resumed(&state.pool, dev.id).await? == 0 {
            continue; // raced with another transition; skip the WG/event work
        }
        if let Err(e) = state
            .wg
            .add_peer(&dev.public_key, dev.allocated_ip.ip(), None, PERSISTENT_KEEPALIVE)
            .await
        {
            warn!(?e, device_id = %dev.id, "quota resume: wg add_peer failed");
        }
        announce(state, dev.id, dev.user_id, PeerStatus::Active, ChangeAction::Unpaused);
        notify(
            state,
            dev.user_id,
            NotifyLevel::Success,
            "Data limit reset",
            "Your monthly data allowance has reset — paused devices are back online.",
            &format!("quota-reset-{}", dev.user_id),
        );
        info!(device_id = %dev.id, "device auto-resumed: quota window reset");
    }

    // 3. Pause active devices over their own cap or the account cap.
    for dev in quota::pause_candidates(&state.pool).await? {
        if quota::mark_auto_paused(&state.pool, dev.id).await? == 0 {
            continue;
        }
        if let Err(e) = state.wg.remove_peer(&dev.public_key).await {
            warn!(?e, device_id = %dev.id, "quota pause: wg remove_peer failed");
        }
        announce(state, dev.id, dev.user_id, PeerStatus::Paused, ChangeAction::Paused);
        let body = if dev.over_device_cap {
            "A device hit its monthly data cap and was paused until the next reset."
        } else {
            "Your account hit its monthly data cap — devices were paused until the next reset."
        };
        notify(
            state,
            dev.user_id,
            NotifyLevel::Error,
            "Device paused — data limit reached",
            body,
            &format!("quota-pause-{}", dev.id),
        );
        info!(device_id = %dev.id, over_device_cap = dev.over_device_cap, "device auto-paused: quota exceeded");
    }

    Ok(())
}

/// Broadcast the peer-status flip and a `DataChanged` so the user's sessions
/// and every admin console refresh the device list / quota in real time.
fn announce(
    state: &AppState,
    device_id: uuid::Uuid,
    user_id: uuid::Uuid,
    status: PeerStatus,
    action: ChangeAction,
) {
    state.broadcast(Event::PeerStatusChanged { device_id, user_id, status });
    state.broadcast(Event::DataChanged {
        user_id: Some(user_id),
        resource: ResourceKind::Device,
        id: Some(device_id),
        action,
    });
}

fn notify(
    state: &AppState,
    user_id: uuid::Uuid,
    level: NotifyLevel,
    title: &str,
    body: &str,
    tag: &str,
) {
    state.broadcast(Event::Notify {
        user_id: Some(user_id),
        level,
        title: title.to_string(),
        body: Some(body.to_string()),
        url: Some("/app".to_string()),
        tag: Some(tag.to_string()),
    });
}
