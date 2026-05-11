import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { useWebSocket } from "@/hooks/useWebSocket"
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
  const pushTail = useEventTail((s) => s.push)

  const onEvent = useCallback(
    (event: Event) => {
      pushTail(event)
      switch (event.type) {
        case "stats_delta":
          applyDelta(
            event.device_id,
            event.rate_rx_bps,
            event.rate_tx_bps,
            event.ts_ms,
          )
          break
        case "peer_status_changed":
          void qc.invalidateQueries({ queryKey: ["devices"] })
          void qc.invalidateQueries({ queryKey: ["device", event.device_id] })
          break
        case "handshake_change":
          void qc.invalidateQueries({ queryKey: ["device", event.device_id] })
          break
        default:
          // heartbeat, dns_updated, server_health — tail handled above
          break
      }
    },
    [applyDelta, pushTail, qc],
  )

  useWebSocket({
    path: "/api/v1/ws",
    onEvent,
    enabled: !!user,
  })

  return null
}
