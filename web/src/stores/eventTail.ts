import { create } from "zustand"

import type { Event } from "@/lib/wire"

const TAIL_CAP = 60

export interface TailLine {
  id: number
  tsMs: number
  kind: Event["type"]
  tone: "ok" | "warn" | "err" | "info" | "muted"
  text: string
  deviceId?: string
}

interface EventTailState {
  lines: TailLine[]
  connectedAt: number | null
  push(event: Event): void
  markConnected(): void
  reset(): void
}

let nextId = 1

function formatRate(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

function toLine(event: Event): TailLine | null {
  switch (event.type) {
    case "stats_delta":
      // Only surface meaningful deltas — otherwise the tail is mostly zeros.
      if (event.rate_rx_bps + event.rate_tx_bps < 1024) return null
      return {
        id: nextId++,
        tsMs: event.ts_ms,
        kind: event.type,
        tone: "ok",
        deviceId: event.device_id,
        text: `device.heartbeat · ${event.device_id.slice(0, 8)} · ${formatRate(event.rate_tx_bps)} tx · ${formatRate(event.rate_rx_bps)} rx`,
      }
    case "peer_status_changed":
      return {
        id: nextId++,
        tsMs: Date.now(),
        kind: event.type,
        tone: event.status === "active" ? "ok" : event.status === "paused" ? "warn" : "err",
        deviceId: event.device_id,
        text: `device.status · ${event.device_id.slice(0, 8)} → ${event.status}`,
      }
    case "handshake_change":
      return {
        id: nextId++,
        tsMs: event.last_handshake_ms,
        kind: event.type,
        tone: "info",
        deviceId: event.device_id,
        text: `device.handshake · ${event.device_id.slice(0, 8)} · ${new Date(event.last_handshake_ms).toLocaleTimeString()}`,
      }
    case "dns_updated":
      return {
        id: nextId++,
        tsMs: Date.now(),
        kind: event.type,
        tone: "info",
        deviceId: event.device_id,
        text: `dns.updated · ${event.device_id.slice(0, 8)} · ${event.dns_names.join(", ") || "(cleared)"}`,
      }
    case "server_health":
      return {
        id: nextId++,
        tsMs: event.ts_ms,
        kind: event.type,
        tone: event.cpu_pct > 80 ? "warn" : "muted",
        text: `server.health · ${event.server_id} · cpu ${event.cpu_pct.toFixed(0)}% · ${event.active_peers} peers`,
      }
    case "heartbeat":
      return null
  }
}

/**
 * Rolling tail of real WebSocket events. The same upstream broadcast the
 * dashboard uses for live throughput populates this tail — every line is a
 * backend-emitted event, never a mock. Consumed by:
 *   - <LiveEventStream> (full terminal tail panel)
 *   - <RecentActivity>  (for non-admin users, where /admin/audit isn't
 *                       reachable — we derive a per-user activity feed from
 *                       their own filtered events)
 */
export const useEventTail = create<EventTailState>((set) => ({
  lines: [],
  connectedAt: null,
  push(event) {
    const line = toLine(event)
    if (!line) return
    set((state) => {
      const next = state.lines.length < TAIL_CAP
        ? [...state.lines, line]
        : [...state.lines.slice(state.lines.length - TAIL_CAP + 1), line]
      return {
        lines: next,
        connectedAt: state.connectedAt ?? line.tsMs,
      }
    })
  },
  markConnected() {
    set({ connectedAt: Date.now() })
  },
  reset() {
    set({ lines: [], connectedAt: null })
  },
}))
