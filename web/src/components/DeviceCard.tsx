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
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card"
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

export function DeviceCard({
  device: d,
  onPause,
  onUnpause,
  onRevoke,
  pending,
}: Props) {
  const live = useLiveStats((s) => s.devices[d.id])

  return (
    <Card className="hover:border-foreground/20 group flex flex-col transition-colors">
      <CardHeader className="space-y-0 pb-3">
        <div className="flex items-start justify-between gap-2">
          <Link
            to={`/app/devices/${d.id}`}
            className="hover:text-primary group/link flex min-w-0 flex-col gap-0.5 transition-colors"
          >
            <span className="truncate text-sm font-medium">{d.name}</span>
            <span className="text-muted-foreground text-xs capitalize">
              {d.os}
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <StatusPill status={d.status as Status} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
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
      </CardHeader>

      <CardContent className="flex-1 space-y-3 pb-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">IP</dt>
          <dd className="text-right font-mono">{d.allocated_ip}</dd>
          <dt className="text-muted-foreground">Last handshake</dt>
          <dd className="text-right text-muted-foreground">
            <RelativeTime value={d.last_handshake_at} fallback="Never" />
          </dd>
        </dl>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider">
            <span className="text-muted-foreground">Live</span>
            <span className="text-muted-foreground tabular-nums">
              {d.status === "active" ? formatBps(live?.rxBps ?? 0) + " ↓ · " + formatBps(live?.txBps ?? 0) + " ↑" : "—"}
            </span>
          </div>
          <MiniAreaChart
            rxHistory={live?.rxHistory ?? []}
            txHistory={live?.txHistory ?? []}
            height={48}
          />
        </div>
      </CardContent>

      <CardFooter className="border-t pt-3">
        <dl className="grid w-full grid-cols-2 gap-x-3 text-xs">
          <div className="space-y-0.5">
            <dt className="text-muted-foreground inline-flex items-center gap-1 text-[10px] uppercase tracking-wider">
              <IconArrowDown className="size-3" /> Total RX
            </dt>
            <dd className="text-foreground tabular-nums">
              {formatBytes(live?.totalRx ?? 0)}
            </dd>
          </div>
          <div className="space-y-0.5 text-right">
            <dt className="text-muted-foreground inline-flex items-center gap-1 text-[10px] uppercase tracking-wider">
              <IconArrowUp className="size-3" /> Total TX
            </dt>
            <dd className="text-foreground tabular-nums">
              {formatBytes(live?.totalTx ?? 0)}
            </dd>
          </div>
        </dl>
      </CardFooter>
    </Card>
  )
}

function formatBps(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

function formatBytes(n: number): string {
  // The store accumulates *bps*, not bytes, so this is an approximation
  // for "how much data has flowed through this card since the page
  // mounted." Good enough for an at-a-glance card footer.
  if (n < 1_000) return `${Math.round(n)} bps·s`
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)} kb·s`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} Mb·s`
  return `${(n / 1_000_000_000).toFixed(2)} Gb·s`
}
