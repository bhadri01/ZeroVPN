import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef } from "react"

import { isPageVisible } from "@/hooks/usePageVisible"
import { useWebSocket } from "@/hooks/useWebSocket"
import type { PublicDevice } from "@/lib/api"
import { notify } from "@/lib/notify"
import type { Event } from "@/lib/wire"
import { useEventTail } from "@/stores/eventTail"
import { useLiveStats } from "@/stores/liveStats"
import { useAuth } from "@/stores/auth"

/**
 * Mounts a single WebSocket connection for the lifetime of the
 * authenticated session and fans out events:
 *   - `stats_delta`           → liveStats store
 *   - `peer_status_changed`   → invalidate the devices query
 *
 * Lives inside `DashboardLayout` (above the route Outlet) so it survives
 * navigation between /app, /app/devices, /app/devices/:id, and /admin/*.
 *
 * Renders nothing — purely a side-effect host.
 */
export function LiveStatsProvider() {
  const user = useAuth((s) => s.user)
  const qc = useQueryClient()
  const applyDelta = useLiveStats((s) => s.applyDelta)
  const applyServerSample = useLiveStats((s) => s.applyServerSample)
  const applyServerHealth = useLiveStats((s) => s.applyServerHealth)
  const pushTail = useEventTail((s) => s.push)
  // Tracks whether we skipped any deltas while the tab was hidden. When
  // the tab comes back we trigger a re-fetch of the devices query so the
  // UI catches up without us replaying the throughput history we dropped
  // (the chart re-hydrates from the historical API in the relevant pages).
  const skippedWhileHiddenRef = useRef(false)

  const onEvent = useCallback(
    (event: Event) => {
      // Hot-path events (per-tick samples) drive history arrays of up to
      // 1800 frames; cloning those at 1+ Hz while the user can't see the
      // chart is what crashes the renderer after a few hours in the
      // background. Drop them while hidden — the queries below already
      // refresh on resume, and the historical endpoint backfills any gap.
      const visible = isPageVisible()

      if (visible) {
        pushTail(event)
      }

      switch (event.type) {
        case "stats_delta":
          if (visible) {
            applyDelta(
              event.device_id,
              event.rate_rx_bps,
              event.rate_tx_bps,
              event.ts_ms,
            )
          } else {
            skippedWhileHiddenRef.current = true
          }
          break
        case "server_sample":
          if (visible) {
            applyServerSample(
              event.server_id,
              event.rate_rx_bps,
              event.rate_tx_bps,
              event.peer_count,
              event.online_count,
              event.handshake_count,
              event.ts_ms,
            )
          } else {
            skippedWhileHiddenRef.current = true
          }
          break
        case "peer_status_changed": {
          // Status flips are rare AND structural — always apply, the cost
          // is a single query invalidation. Lets `/devices` repaint
          // immediately when the tab comes back to find a paused peer.
          const cached = qc.getQueryData<PublicDevice[]>(["devices"])
          const dev = cached?.find((d) => d.id === event.device_id)
          const label = dev?.name ?? "A device"
          if (event.status === "revoked") {
            notify.error(`${label} was revoked`, {
              description: "All sessions for this device have been ended.",
              important: true,
              id: `dev-${event.device_id}-revoked`,
            })
          } else if (event.status === "paused") {
            notify.warning(`${label} was paused`, {
              description: "Reconnect from the device settings when ready.",
              important: true,
              id: `dev-${event.device_id}-paused`,
            })
          } else if (event.status === "active" && dev && dev.status !== "active") {
            notify.success(`${label} is active again`, {
              id: `dev-${event.device_id}-active`,
            })
          }
          void qc.invalidateQueries({ queryKey: ["devices"] })
          void qc.invalidateQueries({ queryKey: ["device", event.device_id] })
          break
        }
        case "handshake_change":
          if (visible) {
            void qc.invalidateQueries({ queryKey: ["device", event.device_id] })
          }
          break
        case "server_health":
          // Admin-only event (filtered server-side). Always apply; the
          // 5-second cadence is cheap and the sidebar panel reads from
          // this slot on every render.
          if (visible) {
            applyServerHealth(
              event.server_id,
              event.cpu_pct,
              event.mem_used_bytes,
              event.mem_total_bytes,
              event.active_peers,
              event.disk_read_bps,
              event.disk_write_bps,
              event.net_rx_bps,
              event.net_tx_bps,
              event.uptime_sec,
              event.ts_ms,
            )
          }
          break
        default:
          // heartbeat, dns_updated — tail handled above
          break
      }
    },
    [applyDelta, applyServerHealth, applyServerSample, pushTail, qc],
  )

  // When the tab regains focus after we skipped any deltas, refetch the
  // devices list so live status / handshake / quotas are current. The
  // per-device charts will re-hydrate from their history endpoints via
  // the dashboard's useHistoryHydration call.
  useEffect(() => {
    const onVis = () => {
      if (isPageVisible() && skippedWhileHiddenRef.current) {
        skippedWhileHiddenRef.current = false
        void qc.invalidateQueries({ queryKey: ["devices"] })
      }
    }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [qc])

  useWebSocket({
    path: "/api/v1/ws",
    onEvent,
    enabled: !!user,
  })

  return null
}
