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
import { RelativeTime } from "@/components/RelativeTime"
import { StatusPill, type Status as PillStatus } from "@/components/StatusPill"
import { WithTooltip } from "@/components/ui/with-tooltip"
import type { PublicDevice } from "@/lib/api"
import { connState, peerState } from "@/lib/deviceState"
import { compactBytes, formatBps } from "@/lib/units"
import { cn } from "@/lib/utils"
import { useLiveStats } from "@/stores/liveStats"

/** Frames of live history rendered on each card's mini chart. The store
 *  retains up to 1800 frames (30 min at 1 Hz) but the card is small —
 *  a shorter window keeps the trace readable and stops the Y axis being
 *  pulled by an hour-old spike. */
const CHART_WINDOW = 30

/** Pill the header shows — combines connection state (handshake-derived)
 *  with peer state (admin lifecycle) so a paused or revoked device
 *  always wins over the bare online/offline label. */
function rowPill(d: PublicDevice): PillStatus {
  const c = connState(d)
  const p = peerState(d)
  if (p === "revoked") return "revoked"
  if (p === "paused") return "paused"
  return c
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
 *  status pill, live RX/TX rates, a mini RX/TX history chart, and a
 *  footer with last-handshake + cumulative bytes.
 *
 *  Live rates are gated on `connState(d) === "online"` (recent handshake)
 *  rather than just `status === "active"` so a device that hasn't
 *  handshook in 3 minutes shows "—" instead of the stale rate the
 *  store still holds from before it dropped.
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
  const hasEverHandshook = d.last_handshake_at != null
  const isOnline = hasEverHandshook && connState(d) === "online"
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

  return (
    <div
      {...divProps}
      className={cn(
        "zv-panel group/card relative flex cursor-pointer flex-col transition-colors",
        // Drag-state visuals — kick in when callers set
        // data-dragging="1" / data-drop-target="1" on the root.
        // While being dragged the cursor switches to grabbing on the
        // whole card so it doesn't visually contradict the operation.
        "data-[dragging=1]:cursor-grabbing data-[dragging=1]:opacity-40",
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
          className="border-border bg-card text-muted-foreground/40 group-hover/card:text-muted-foreground hover:text-foreground hover:border-foreground absolute left-1.5 top-1.5 z-10 inline-flex size-5 cursor-grab select-none items-center justify-center border opacity-0 transition-[opacity,color,border-color] group-hover/card:opacity-100 active:cursor-grabbing"
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
        </Link>
        <div className="flex items-center gap-1">
          <StatusPill status={rowPill(d)} />
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

      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <RateBlock
          label="↓ RX"
          value={isOnline ? formatBps(rxBps) : "—"}
          color="text-status-online"
        />
        <RateBlock
          label="↑ TX"
          value={isOnline ? formatBps(txBps) : "—"}
          color="text-primary"
        />
      </div>

      <div className="-mb-4 px-1">
        <MiniAreaChart rxHistory={rxHistory} txHistory={txHistory} height={56} />
      </div>

      <div className="border-border bg-muted/40 flex items-center justify-between gap-3 border-t px-4 py-2.5 font-mono text-[11px]">
        <span className="text-muted-foreground inline-flex items-center gap-1.5">
          <span className="bg-status-paused size-1 rounded-full" aria-hidden />
          <RelativeTime value={d.last_handshake_at} fallback="Never" />
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-2 tabular-nums">
          <span className="inline-flex items-center gap-0.5">
            <IconArrowDown className="size-2.5" />
            {hasEverHandshook ? compactBytes(totalRx) : "—"}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <IconArrowUp className="size-2.5" />
            {hasEverHandshook ? compactBytes(totalTx) : "—"}
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
