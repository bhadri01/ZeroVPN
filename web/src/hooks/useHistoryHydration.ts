import { useQueries } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { deviceHistory, serverHistory } from "@/lib/api"
import type {
  DeviceHistoryPoint,
  DeviceHistoryResponse,
  ServerHistoryPoint,
  ServerHistoryResponse,
} from "@/lib/api"
import {
  useLiveStats,
  type HistoricalPoint,
  type ServerHistoricalPoint,
} from "@/stores/liveStats"

/**
 * On mount, fetch tick-level history for the given device + server ids
 * and seed the `liveStats` store so the chart renders immediately with
 * data from before the page was opened. Live WS deltas continue on top.
 *
 * - `windowSec` (default 300) is the lookback window — must be ≤ the
 *   store's HISTORY_CAP (300 frames at 1 Hz).
 * - Each fetch is cached by react-query so navigating away + back is
 *   free until the cache stales.
 *
 * Pass empty arrays to skip — caller owns the lifecycle.
 */
export function useHistoryHydration(opts: {
  deviceIds?: string[]
  serverIds?: string[]
  windowSec?: number
}) {
  const { deviceIds = [], serverIds = [], windowSec = 300 } = opts
  const hydrateDevice = useLiveStats((s) => s.hydrateDevice)
  const hydrateServer = useLiveStats((s) => s.hydrateServer)

  // Pin the lookback window to the moment the component mounted.
  // Hydration is a one-shot — after the first fetch, live WS deltas
  // carry the chart forward, so re-bucketing the window on every render
  // would only churn the cache.
  const [{ from, to }] = useState(() => {
    const now = Date.now()
    return {
      from: new Date(now - windowSec * 1000).toISOString(),
      to: new Date(now).toISOString(),
    }
  })

  // useQueries is the right tool here — N queries with variable N
  // without breaking Rules of Hooks.
  const deviceQueries = useQueries({
    queries: deviceIds.map((id) => ({
      queryKey: ["device-history", id, from, to] as const,
      queryFn: () => deviceHistory(id, { from, to, limit: windowSec }),
      enabled: !!id,
    })),
  })

  const serverQueries = useQueries({
    queries: serverIds.map((id) => ({
      queryKey: ["server-history", id, from, to] as const,
      queryFn: () => serverHistory(id, { from, to, limit: windowSec }),
      enabled: !!id,
    })),
  })

  // Hydrate the store whenever a query lands. Stringifying the data
  // identity into the dep array is fine here — typical responses are <10
  // KB and the query cache keeps the same reference across renders.
  const deviceDataKey = deviceQueries.map((q) => q.dataUpdatedAt).join("|")
  useEffect(() => {
    deviceQueries.forEach((q, i) => {
      const data = q.data as DeviceHistoryResponse | undefined
      if (data) {
        hydrateDevice(deviceIds[i], toDevicePoints(data.samples))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceDataKey])

  const serverDataKey = serverQueries.map((q) => q.dataUpdatedAt).join("|")
  useEffect(() => {
    serverQueries.forEach((q, i) => {
      const data = q.data as ServerHistoryResponse | undefined
      if (data) {
        hydrateServer(serverIds[i], toServerPoints(data.samples))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDataKey])

  const isLoading =
    deviceQueries.some((q) => q.isLoading) ||
    serverQueries.some((q) => q.isLoading)

  return { isLoading, deviceQueries, serverQueries }
}

// ---------------------------------------------------------------------------
// Convert per-tick byte deltas → bits-per-second so the historical points
// align with `Event::StatsDelta.rate_rx_bps` from the live stream. The
// interval is inferred from the time gap between consecutive samples;
// fall back to 1 s for a single-point payload.
// ---------------------------------------------------------------------------

function toDevicePoints(samples: DeviceHistoryPoint[]): HistoricalPoint[] {
  return samples.map((s, i) => {
    const ts = Date.parse(s.sampled_at)
    const prevTs = i > 0 ? Date.parse(samples[i - 1].sampled_at) : ts - 1000
    const gapSec = Math.max(1, Math.round((ts - prevTs) / 1000))
    return {
      ts,
      rxBps: Math.round((s.rx_bytes / gapSec) * 8),
      txBps: Math.round((s.tx_bytes / gapSec) * 8),
    }
  })
}

function toServerPoints(samples: ServerHistoryPoint[]): ServerHistoricalPoint[] {
  return samples.map((s, i) => {
    const ts = Date.parse(s.sampled_at)
    const prevTs = i > 0 ? Date.parse(samples[i - 1].sampled_at) : ts - 1000
    const gapSec = Math.max(1, Math.round((ts - prevTs) / 1000))
    return {
      ts,
      rxBps: Math.round((s.total_rx_bytes / gapSec) * 8),
      txBps: Math.round((s.total_tx_bytes / gapSec) * 8),
      peerCount: s.peer_count,
      onlineCount: s.online_count,
      handshakeCount: s.handshake_count,
    }
  })
}
