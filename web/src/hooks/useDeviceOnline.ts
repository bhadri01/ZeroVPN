import { useEffect, useState } from "react"

import { useNow } from "@/hooks/useNow"
import type { PublicDevice } from "@/lib/api"
import { connState } from "@/lib/deviceState"
import { useLiveStats } from "@/stores/liveStats"

/** A connected peer's rx advances at least every PersistentKeepalive (30s),
 *  so allow ~3 missed keepalives before declaring it dropped. This flips a
 *  peer offline ~90s after it actually disconnects — far faster than waiting
 *  out the ~3-min handshake window — without false drops from a single lost
 *  keepalive packet. Kept in sync with the worker's `OFFLINE_AFTER_SECS`. */
export const ACTIVITY_STALE_MS = 90_000

/**
 * Pure form of the connectivity rule for callers that already hold the live
 * `lastSeenTs` + a `now` tick (e.g. a list mapping many devices, where a hook
 * per row isn't possible). `settled` should be `now - tabVisibleSince >
 * ACTIVITY_STALE_MS` — see the visibility guard note on {@link useDeviceOnline}.
 */
export function isLiveOnline(
  device: PublicDevice,
  lastSeenTs: number,
  now: number,
  settled: boolean,
): boolean {
  if (device.last_handshake_at == null) return false
  if (connState(device) !== "online") return false
  const activityStale =
    lastSeenTs > 0 && now - lastSeenTs > ACTIVITY_STALE_MS && settled
  return !activityStale
}

/**
 * Effective "is this peer online right now?" — the coarse handshake window
 * (`connState`, ~3 min) refined by live keepalive activity so a drop surfaces
 * in ~90s.
 *
 * WireGuard peers behind NAT can't be reliably probed from the server, so the
 * device's PersistentKeepalive *is* the heartbeat: while connected the server
 * sees rx every ~30s (tracked in the live store as `lastSeenTs`). When that
 * goes stale the peer has dropped — we flip offline immediately instead of
 * waiting for the handshake to expire.
 *
 * The visibility guard avoids a false "offline" flash right after refocusing a
 * backgrounded tab: we stop receiving stats while hidden, so `lastSeenTs` is
 * stale until the next keepalive lands — give it a full window to catch up.
 *
 * Accepts a nullable device so callers can invoke it before their data has
 * loaded (keeps hook order stable across an early `return`).
 */
export function useDeviceOnline(device: PublicDevice | null | undefined): boolean {
  const lastSeenTs = useLiveStats((s) =>
    device ? (s.devices[device.id]?.lastSeenTs ?? 0) : 0,
  )
  // 1 Hz tick so staleness re-evaluates every second without needing an event.
  const now = useNow()

  // Timestamp the tab last (re)gained focus — see the visibility guard above.
  const [visibleSince, setVisibleSince] = useState(() => Date.now())
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "hidden") setVisibleSince(Date.now())
    }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [])

  if (!device) return false
  return isLiveOnline(device, lastSeenTs, now, now - visibleSince > ACTIVITY_STALE_MS)
}
