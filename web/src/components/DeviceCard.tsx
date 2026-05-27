import {
  IconArrowDown,
  IconArrowUp,
  IconExternalLink,
  IconGripVertical,
} from "@tabler/icons-react"
import {
  useMemo,
  type HTMLAttributes,
  type PointerEventHandler,
  type ReactNode,
} from "react"
import { Link } from "react-router"

import { MiniAreaChart } from "@/components/charts/LazyMiniAreaChart"
import { CopyButton } from "@/components/CopyButton"
import { StatusPill, type Status as PillStatus } from "@/components/StatusPill"
import { WithTooltip } from "@/components/ui/with-tooltip"
import { useDeviceOnline } from "@/hooks/useDeviceOnline"
import { useDeviceDetailGated } from "@/hooks/useDeviceDetailGated"
import { useLiveTotal } from "@/hooks/useLiveTotal"
import { useNow } from "@/hooks/useNow"
import type { PublicDevice } from "@/lib/api"
import { formatAgo, formatDateTime } from "@/lib/datetime"
import { DEVICE_TYPE_ICONS, deviceTypeLabel, osLabel } from "@/lib/deviceIcons"
import {
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
  const hideDetail = useDeviceDetailGated()

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

  const hasEverHandshook = d.last_handshake_at != null
  // Effective connectivity: the handshake window refined by live keepalive
  // activity, so a dropped peer flips offline in ~90s instead of waiting out
  // the full ~3-min handshake window. See useDeviceOnline.
  const isOnline = useDeviceOnline(d)
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
  // Only draw the live trace once the device is online AND at least one
  // frame has streamed in. Otherwise the chart slot shows a flat baseline
  // placeholder; the moment a connect lands its frames, the real chart
  // takes over and grows from there.
  const showChart = isOnline && (rxHistory.length > 0 || txHistory.length > 0)
  // Cumulative byte totals: the persisted API figure (survives reload)
  // grown live by the bytes streamed since the last refetch, so the number
  // ticks up in sync with the live rate instead of only on refetch.
  const { rx: totalRx, tx: totalTx } = useLiveTotal(
    d.id,
    d.total_rx_bytes,
    d.total_tx_bytes,
  )

  // WAN endpoint IP only — the port is noise on the card.
  const peerHost = d.last_peer_endpoint
    ? endpointHost(d.last_peer_endpoint)
    : null

  // Device-type icon before the name — a glanceable indicator of what the
  // peer is (laptop / phone / server …).
  const TypeIcon = DEVICE_TYPE_ICONS[d.device_type]

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
      {/* Header: name + status share the top row; the IP and WAN endpoint
          each get their own full-width line below so they never get squeezed
          (and wrapped) by a wide status pill. Fixed line count keeps every
          card the same height across the grid. */}
      <div className="flex flex-col gap-0.5 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          {hideDetail ? (
            <span className="text-foreground inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
              <TypeIcon
                className="text-muted-foreground size-4 shrink-0"
                title={`${deviceTypeLabel(d.device_type)} · ${osLabel(d.os)}`}
              />
              <span className="truncate">{d.name}</span>
            </span>
          ) : (
            <Link
              to={`/app/devices/${d.id}`}
              draggable={false}
              className="text-foreground hover:text-foreground inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium transition-colors"
            >
              <TypeIcon
                className="text-muted-foreground size-4 shrink-0"
                title={`${deviceTypeLabel(d.device_type)} · ${osLabel(d.os)}`}
              />
              <span className="truncate">{d.name}</span>
            </Link>
          )}
          <div className="flex shrink-0 items-center gap-1">
            <StatusPill status={rowPill(isOnline ? "online" : "offline", peerState(d))} />
            {actions}
            {showOpenLink && !actions && !hideDetail && (
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
        {/* IP — full card width, single line, with a copy affordance. */}
        <div className="flex items-center gap-1.5">
          {hideDetail ? (
            <span className="text-muted-foreground min-w-0 truncate font-mono text-xs">
              {d.allocated_ip}
            </span>
          ) : (
            <Link
              to={`/app/devices/${d.id}`}
              draggable={false}
              className="text-muted-foreground hover:text-foreground min-w-0 truncate font-mono text-xs transition-colors"
            >
              {d.allocated_ip}
            </Link>
          )}
          <CopyButton value={d.allocated_ip} label="Copy IP" />
        </div>
        {/* WAN endpoint the peer connects from. Always rendered (with a dim
            placeholder when unknown) so cards keep a uniform height. The
            copy button only appears once there's an endpoint to copy. */}
        <div className="flex items-center gap-1.5">
          <span
            className="text-muted-foreground/60 min-w-0 truncate font-mono text-[11px]"
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
          {d.last_peer_endpoint && (
            <CopyButton value={d.last_peer_endpoint} label="Copy endpoint" />
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
        {showChart ? (
          <MiniAreaChart rxHistory={rxHistory} txHistory={txHistory} height={56} />
        ) : (
          <ChartPlaceholder
            text={
              isOnline
                ? "connecting…"
                : hasEverHandshook
                  ? "offline"
                  : "not connected"
            }
          />
        )}
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

/** Chart-slot fallback when there's no live trace to draw — a flat
 *  baseline with a short status string, sized to the same box as the real
 *  sparkline so the card/row height never jumps. Once the device connects
 *  and frames stream in, the live MiniAreaChart replaces this and grows
 *  from that point. Shared by the grid card and the list-view row. */
export function ChartPlaceholder({
  text,
  height = 56,
}: {
  text: string
  height?: number
}) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ height }}
    >
      <span
        className="bg-border absolute inset-x-1 top-1/2 h-px -translate-y-1/2"
        aria-hidden
      />
      <span className="bg-card text-muted-foreground/70 relative px-2 font-mono text-[10px] tracking-[0.08em]">
        {text}
      </span>
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
