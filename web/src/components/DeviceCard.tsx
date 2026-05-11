import {
  IconArrowDown,
  IconArrowUp,
  IconDots,
  IconExternalLink,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react"
import { Link } from "react-router"

import { MiniAreaChart } from "@/components/charts/LazyMiniAreaChart"
import { RelativeTime } from "@/components/RelativeTime"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { PublicDevice } from "@/lib/api"
import { useLiveStats } from "@/stores/liveStats"

interface Props {
  device: PublicDevice
  onPause: (id: string) => void
  onUnpause: (id: string) => void
  onRevoke: (id: string) => void
  pending?: boolean
}

/** Swiss device card — hairline frame, mono labels, dual rate blocks,
 * full-width sparkline strip, meta footer. Replaces the violet-haloed
 * version with a flat, dense, paper-feeling tile. */
export function DeviceCard({
  device: d,
  onPause,
  onUnpause,
  onRevoke,
  pending,
}: Props) {
  const live = useLiveStats((s) => s.devices[d.id])
  const isActive = d.status === "active"

  return (
    <div className="zv-panel relative flex flex-col">
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
        <Link
          to={`/app/devices/${d.id}`}
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
          <StatusPill status={d.status as Status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground -mr-1"
                aria-label="Device actions"
              >
                <IconDots className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[10rem]">
              <DropdownMenuItem asChild>
                <Link to={`/app/devices/${d.id}`}>
                  <IconExternalLink />
                  View details
                </Link>
              </DropdownMenuItem>
              {d.status === "active" && (
                <DropdownMenuItem
                  onSelect={() => onPause(d.id)}
                  disabled={pending}
                >
                  <IconPlayerPause />
                  Pause
                </DropdownMenuItem>
              )}
              {d.status === "paused" && (
                <DropdownMenuItem
                  onSelect={() => onUnpause(d.id)}
                  disabled={pending}
                >
                  <IconPlayerPlay />
                  Unpause
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onRevoke(d.id)}
                disabled={d.status === "revoked"}
                className="text-destructive focus:text-destructive"
              >
                <IconTrash />
                Revoke
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <RateBlock
          label="↓ RX"
          value={isActive ? formatBps(live?.rxBps ?? 0) : "—"}
          color="text-status-online"
        />
        <RateBlock
          label="↑ TX"
          value={isActive ? formatBps(live?.txBps ?? 0) : "—"}
          color="text-primary"
        />
      </div>

      <div className="-mb-4 px-1">
        <MiniAreaChart
          rxHistory={live?.rxHistory ?? []}
          txHistory={live?.txHistory ?? []}
          height={56}
        />
      </div>

      <div className="border-border bg-muted/40 flex items-center justify-between gap-3 border-t px-4 py-2.5 font-mono text-[11px]">
        <span className="text-muted-foreground inline-flex items-center gap-1.5">
          <span className="bg-status-paused size-1 rounded-full" aria-hidden />
          <RelativeTime value={d.last_handshake_at} fallback="Never" />
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-2 tabular-nums">
          <span className="inline-flex items-center gap-0.5">
            <IconArrowDown className="size-2.5" />
            {compactBytes(live?.totalRx ?? 0)}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <IconArrowUp className="size-2.5" />
            {compactBytes(live?.totalTx ?? 0)}
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
        className={`font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${color}`}
      >
        {label}
      </p>
      <p className="text-foreground font-heading text-base font-medium tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  )
}

function formatBps(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

function compactBytes(n: number): string {
  if (n < 1_000) return `${Math.round(n)}`
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return `${(n / 1_000_000_000).toFixed(2)}G`
}
