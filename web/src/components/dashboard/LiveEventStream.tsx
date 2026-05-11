import { useEffect, useRef } from "react"

import { useEventTail } from "@/stores/eventTail"

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function formatTs(tsMs: number, baseMs: number) {
  const diff = Math.max(0, Math.floor((tsMs - baseMs) / 1000))
  return `+${pad2(Math.floor(diff / 60))}:${pad2(diff % 60)}`
}

const TONE_DOT: Record<string, string> = {
  ok: "var(--status-online)",
  warn: "var(--status-degraded)",
  err: "var(--destructive)",
  info: "#5a9cff",
  muted: "var(--muted-foreground)",
}

/**
 * Terminal-style event tail. Reads from the shared event-tail store
 * populated by the main WebSocket connection. Every line is a real
 * backend-emitted event (stats_delta / handshake_change / peer_status_changed
 * / dns_updated / server_health for admins).
 */
export function LiveEventStream() {
  const lines = useEventTail((s) => s.lines)
  const connectedAt = useEventTail((s) => s.connectedAt)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Anchor relative timestamps to the first line we ever saw, falling back
  // to "now" so the display still makes sense on a fresh session.
  const baseMs = connectedAt ?? lines[0]?.tsMs ?? Date.now()

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines.length])

  return (
    <div
      ref={scrollRef}
      className="text-muted-foreground max-h-[420px] overflow-y-auto py-2 font-mono text-[11px] leading-[1.55]"
    >
      {lines.length === 0 && (
        <div className="text-muted-foreground/70 px-4 py-2">
          waiting for first event…
        </div>
      )}
      {lines.map((ln) => (
        <div key={ln.id} className="flex items-baseline gap-2 px-4 py-[2px]">
          <span className="text-muted-foreground/60 w-12 shrink-0">
            {formatTs(ln.tsMs, baseMs)}
          </span>
          <span
            className="shrink-0"
            style={{ color: TONE_DOT[ln.tone] }}
            aria-hidden
          >
            ●
          </span>
          <span className="text-foreground/85 truncate">{ln.text}</span>
        </div>
      ))}
      <div className="flex items-baseline gap-2 px-4 py-[2px]">
        <span className="text-muted-foreground/60 w-12 shrink-0">
          {formatTs(Date.now(), baseMs)}
        </span>
        <span className="text-primary shrink-0" aria-hidden>
          ▌
        </span>
      </div>
    </div>
  )
}
