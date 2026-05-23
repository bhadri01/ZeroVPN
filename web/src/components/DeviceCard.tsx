import {
  IconArrowDown,
  IconArrowUp,
  IconExternalLink,
  IconGripVertical,
} from "@tabler/icons-react"
import {
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type PointerEventHandler,
  type ReactNode,
} from "react"
import { Link } from "react-router"

import { MiniAreaChart } from "@/components/charts/LazyMiniAreaChart"
import { StatusPill, type Status as PillStatus } from "@/components/StatusPill"
import { WithTooltip } from "@/components/ui/with-tooltip"
import { useNow } from "@/hooks/useNow"
import type { PublicDevice } from "@/lib/api"
import { formatAgo, formatDateTime } from "@/lib/datetime"
import {
  connState,
  endpointHost,
  peerState,
  type ConnState,
  type PeerState,
} from "@/lib/deviceState"
import { compactBytes, formatBps } from "@/lib/units"
import { cn } from "@/lib/utils"
import { useLiveStats } from "@/stores/liveStats"

/** Frames of live history rendered on each card's mini chart. The store
 *  retains up to 1800 frames (30 min at 1 Hz) but the card is small —
 *  a shorter window keeps the trace readable and stops the Y axis being
 *  pulled by an hour-old spike. */
const CHART_WINDOW = 30

/** How long a previously-active peer can go without moving a byte before
 *  we treat it as disconnected. Peer configs ship `PersistentKeepalive =
 *  25s`, so a live peer's rx advances at least that often; ~3× that gives
 *  a robust, flicker-free drop signal that's far quicker than waiting out
 *  the ~3-min WireGuard handshake window. See `DeviceLive.lastSeenTs`. */
const ACTIVITY_STALE_MS = 75_000

/** Pill the header shows — combines connection state with peer state
 *  (admin lifecycle) so a paused or revoked device always wins over the
 *  bare online/offline label. Takes the *effective* connection state so
 *  the caller can fold in faster-than-handshake drop detection. */
function rowPill(conn: ConnState, p: PeerState): PillStatus {
  if (p === "revoked") return "revoked"
  if (p === "paused") return "paused"
  return conn
}

export interface DeviceCardProps extends HTMLAttributes<HTMLDivElement> {
  device: PublicDevice
  /** Optional action slot rendered to the right of the status pill in
   *  the header. Use this for pause / resume / revoke icon buttons on
   *  pages where the user can manage the device. */
  actions?: ReactNode
  /** When no `actions` are supplied (e.g. read-only views like Finder),
   *  render an external-link icon next to the status pill that opens
   *  the device-detail page. Set to false to suppress the affordance
   *  entirely. Defaults to true. */
  showOpenLink?: boolean
  /** When present, render a grip handle in the card's top-left corner
   *  and route drag-source props through it instead of making the
   *  whole card draggable. The handle gets a grab cursor on hover and
   *  grabbing while held; the rest of the card stays clickable. Pointer
   *  events are the supported path now (motion `<Reorder>` drives drag
   *  via `onPointerDown`); the older HTML5-drag props are kept on the
   *  type so the previous integration site doesn't have to change in
   *  the same commit. */
  dragHandleProps?: {
    onPointerDown?: PointerEventHandler<HTMLDivElement>
  }
}

/** Single, shared visual representation of a device — used by the Finder
 *  results grid and the Devices grid view. Always shows: name, OS, IP,
 *  WAN endpoint, status pill, cumulative RX/TX totals (the headline
 *  blocks), a mini RX/TX history chart, and a footer with last-handshake
 *  plus the live RX/TX I/O rate.
 *
 *  The live rate (now in the footer) is gated on `connState(d) === "online"`
 *  (recent handshake) rather than just `status === "active"` so a device
 *  that hasn't handshook in 3 minutes shows "—" instead of the stale rate
 *  the store still holds from before it dropped. Totals show whenever the
 *  device has ever handshook.
 *
 *  All standard `<div>` attributes pass through to the root, so callers
 *  can attach drag handlers, data-attributes for drag visuals, refs,
 *  etc. without prop drilling. */
export function DeviceCard({
  device: d,
  actions,
  showOpenLink = true,
  dragHandleProps,
  className,
  ...divProps
}: DeviceCardProps) {
  const live = useLiveStats((s) => s.devices[d.id])

  // "Real data" gate. The wg-poller emits a StatsDelta for every peer
  // listed by `wg show dump`, including those whose `latest_handshake`
  // is still 0 — so the live store happily accumulates non-zero
  // counters for peers that have never actually completed a handshake.
  // We refuse to surface any of that until we have a real handshake on
  // record. Once the device has ever connected, the counters reflect
  // real traffic from that point on.
  // 1 Hz tick so the relative "last seen" label counts up live and the
  // staleness check below re-evaluates every second (handshake-window
  // expiry + keepalive drop both surface within ~1s, no event needed).
  const now = useNow()

  // Timestamp the tab last (re)gained focus. While hidden we stop
  // receiving stats, so `lastSeenTs` goes stale for peers that are still
  // up; without this guard, refocusing would flash a live device
  // "offline" until its next keepalive lands. We only trust the drop
  // signal once stats have had a full staleness window to flow in again.
  const [visibleSince, setVisibleSince] = useState(() => Date.now())
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "hidden") setVisibleSince(Date.now())
    }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [])

  const hasEverHandshook = d.last_handshake_at != null
  // Connectivity = the coarse handshake window, refined by keepalive
  // activity. A live peer's rx ticks every ~25s (PersistentKeepalive); if
  // we've seen activity and it's since gone stale, the peer dropped — flip
  // offline now instead of waiting out the full handshake window. When
  // we've never seen activity (just connected, or no keepalive) we fall
  // back to the handshake gate, so this never produces a false "offline".
  const lastSeenTs = live?.lastSeenTs ?? 0
  const settledAfterFocus = now - visibleSince > ACTIVITY_STALE_MS
  const activityStale =
    lastSeenTs > 0 && now - lastSeenTs > ACTIVITY_STALE_MS && settledAfterFocus
  const isOnline =
    hasEverHandshook && connState(d) === "online" && !activityStale
  const rxBps = isOnline ? (live?.rxBps ?? 0) : 0
  const txBps = isOnline ? (live?.txBps ?? 0) : 0
  // Slice histories to the last N frames before feeding the chart. When
  // the device is offline (or has never connected) we hand it empty
  // arrays so the chart doesn't keep painting stale lines.
  const rxHistory = useMemo(
    () => (isOnline ? (live?.rxHistory ?? []).slice(-CHART_WINDOW) : []),
    [isOnline, live?.rxHistory],
  )
  const txHistory = useMemo(
    () => (isOnline ? (live?.txHistory ?? []).slice(-CHART_WINDOW) : []),
    [isOnline, live?.txHistory],
  )
  // Cumulative byte counters live in the footer and need their own
  // gate: a device that's been online before and is now offline should
  // still show its accumulated totals — but a device that's never
  // handshook must read zero, regardless of whatever stale rates the
  // worker may have produced.
  const totalRx = hasEverHandshook ? (live?.totalRx ?? 0) : 0
  const totalTx = hasEverHandshook ? (live?.totalTx ?? 0) : 0

  // WAN endpoint IP only — the port is noise on the card.
  const peerHost = d.last_peer_endpoint
    ? endpointHost(d.last_peer_endpoint)
    : null

  return (
    <div
      {...divProps}
      className={cn(
        "zv-panel group/card relative flex cursor-pointer flex-col overflow-hidden transition-colors",
        // Drop-target highlight (when a sibling drag is hovering this
        // card). The data-dragging="1" lift styling is handled in CSS
        // (`.zv-panel[data-dragging="1"]` rule in index.css) so the
        // multi-shadow is readable instead of an arbitrary Tailwind
        // string the size of an essay.
        "data-[drop-target=1]:border-primary data-[drop-target=1]:shadow-[inset_0_0_0_1px_var(--primary)]",
        className,
      )}
    >
      {/* Drag handle — only rendered when the caller supplies drag-source
          props. Absolutely positioned in the top-left corner so it stays
          out of the header's normal flow; the rest of the card keeps its
          existing layout untouched. Faint at rest; lights up on
          card-hover (via group-hover/card) so it doesn't compete with
          the name + status while idle. */}
      {dragHandleProps && (
        <div
          {...dragHandleProps}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          // Mobile (no hover state): grip is always visible AND we use
          // `touch-none` so the browser doesn't capture touchmove for
          // page scrolling — without that, motion's drag controls never
          // see move events and reorder silently does nothing on touch.
          // Desktop (sm:): revert to opacity-0 + group-hover so the grip
          // stays out of the way until the row is hovered.
          className="border-border bg-card text-muted-foreground/60 group-hover/card:text-muted-foreground hover:text-foreground hover:border-foreground absolute left-1.5 top-1.5 z-10 inline-flex size-5 cursor-grab touch-none select-none items-center justify-center border transition-[opacity,color,border-color] active:cursor-grabbing sm:opacity-0 sm:group-hover/card:opacity-100"
        >
          <IconGripVertical className="size-3" />
        </div>
      )}
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
        <Link
          to={`/app/devices/${d.id}`}
          draggable={false}
          className="hover:text-foreground flex min-w-0 flex-col gap-0.5 transition-colors"
        >
          <span className="text-foreground truncate text-sm font-medium">
            {d.name}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            {d.os} · {d.allocated_ip}
          </span>
          {/* WAN endpoint the peer connects from. Always rendered (with a
              dim placeholder when unknown) so cards keep a uniform height
              across the grid. Truncates on long IPv6 endpoints. */}
          <span
            className="text-muted-foreground/60 truncate font-mono text-[11px]"
            title={
              peerHost
                ? d.last_peer_endpoint_at
                  ? `Last connected from ${peerHost} · seen ${formatDateTime(d.last_peer_endpoint_at)}`
                  : `Last connected from ${peerHost}`
                : "No endpoint observed yet"
            }
          >
            via {peerHost ?? "—"}
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <StatusPill status={rowPill(isOnline ? "online" : "offline", peerState(d))} />
          {actions}
          {showOpenLink && !actions && (
            <WithTooltip label="Open device">
              <Link
                to={`/app/devices/${d.id}`}
                aria-label="Open device"
                className="text-muted-foreground hover:text-foreground -mr-1 p-1 transition-colors"
              >
                <IconExternalLink className="size-3.5" />
              </Link>
            </WithTooltip>
          )}
        </div>
      </div>

      {/* Prominent blocks show cumulative totals (the headline number);
          the live I/O rate moves to the footer. */}
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <RateBlock
          label="↓ RX TOTAL"
          value={hasEverHandshook ? compactBytes(totalRx) : "—"}
          color="text-status-online"
        />
        <RateBlock
          label="↑ TX TOTAL"
          value={hasEverHandshook ? compactBytes(totalTx) : "—"}
          color="text-primary"
        />
      </div>

      {/* Fixed-height, clipped box. The chart sits cleanly above the footer
          instead of bleeding into it — the previous `-mb-4` pulled the
          footer up over the sparkline's lower 16px, which read as the
          chart "breaking" into the footer row. `overflow-hidden` + a
          locked height also stops recharts' ResponsiveContainer from
          nudging the card's height as frames stream in. */}
      <div className="h-14 overflow-hidden px-1">
        <MiniAreaChart rxHistory={rxHistory} txHistory={txHistory} height={56} />
      </div>

      <div className="border-border bg-muted/40 flex items-center justify-between gap-3 border-t px-4 py-2.5 font-mono text-[11px]">
        <span className="text-muted-foreground inline-flex items-center gap-1.5">
          <span className="bg-status-paused size-1 rounded-full" aria-hidden />
          <WithTooltip
            label={
              d.last_handshake_at
                ? formatDateTime(d.last_handshake_at)
                : "Never connected"
            }
          >
            <span className="cursor-default whitespace-nowrap">
              {formatAgo(d.last_handshake_at, now, "Never")}
            </span>
          </WithTooltip>
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-2 tabular-nums">
          <span className="inline-flex items-center gap-0.5">
            <IconArrowDown className="size-2.5" />
            {isOnline ? formatBps(rxBps) : "—"}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <IconArrowUp className="size-2.5" />
            {isOnline ? formatBps(txBps) : "—"}
          </span>
        </span>
      </div>
    </div>
  )
}

function RateBlock({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="space-y-0.5">
      <p
        className={cn(
          "font-mono text-[10px] font-medium uppercase tracking-[0.08em]",
          color,
        )}
      >
        {label}
      </p>
      <p className="text-foreground font-heading text-base font-medium tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  )
}
