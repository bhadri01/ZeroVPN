import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconActivity,
  IconArrowDown,
  IconArrowUp,
  IconBolt,
  IconInfoCircle,
  IconServer,
  IconUsers,
} from "@tabler/icons-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  LiveIndicator,
  NetworkMonitorChart,
} from "@/components/charts/LazyNetworkMonitorChart"
import { PageStagger, StaggerItem } from "@/components/motion"
import { Kpi, KpiStrip, PageHead, Panel, Pill } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { WithTooltip } from "@/components/ui/with-tooltip"
import { useHistoryHydration } from "@/hooks/useHistoryHydration"
import {
  ApiError,
  type AdminServerRow,
  adminFleetBandwidth,
  adminGetMaintenance,
  adminListServers,
  adminSetMaintenance,
  adminStats,
} from "@/lib/api"
import { useReducedMotion } from "@/lib/motion"
import { formatBps, formatBytes } from "@/lib/units"
import { useLiveStats } from "@/stores/liveStats"

const SERVER_LIVE_WINDOW_SEC = 300

export function AdminOverviewPage() {
  const qc = useQueryClient()

  // Deployment-wide aggregate counts power the KPI strip below.
  const statsQ = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: adminStats,
    refetchInterval: 30_000,
  })

  // Fleet-wide RX/TX over the last 30 days for the bandwidth KPI.
  const fleetBwQ = useQuery({
    queryKey: ["admin", "fleet-bandwidth"],
    queryFn: adminFleetBandwidth,
    refetchInterval: 5 * 60_000,
  })

  const maintQ = useQuery({
    queryKey: ["admin", "maintenance"],
    queryFn: adminGetMaintenance,
  })

  // Server-level live charts: list servers, hydrate each from the
  // /servers/{id}/history endpoint (5-min lookback so the chart isn't
  // empty after refresh), then live `ServerSample` events from the WS
  // keep them rolling forward.
  const serversQ = useQuery({
    queryKey: ["admin", "servers", "overview"],
    queryFn: adminListServers,
  })
  const serverIds = useMemo(
    () => (serversQ.data ?? []).filter((s) => s.is_active).map((s) => s.id),
    [serversQ.data],
  )
  useHistoryHydration({ serverIds, windowSec: 300 })

  const setMaintM = useMutation({
    mutationFn: (on: boolean) => adminSetMaintenance(on),
    onSuccess: (_d, on) => {
      void qc.invalidateQueries({ queryKey: ["admin", "maintenance"] })
      toast.info(on ? "Maintenance mode ON" : "Maintenance mode OFF")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const stats = statsQ.data
  const total = stats?.total ?? 0
  const active = stats?.active ?? 0
  const suspended = stats?.suspended ?? 0
  const pending = stats?.pending_verification ?? 0
  const totalDevices = stats?.devices_total ?? 0
  const fleetRx = fleetBwQ.data?.rx_bytes ?? 0
  const fleetTx = fleetBwQ.data?.tx_bytes ?? 0
  const maintOn = !!maintQ.data?.maintenance_mode

  // Sum the worker-reported `onlineCount` across every server — devices
  // with a recent WireGuard handshake. Reflects real-time connection
  // pressure on the fleet, vs. the cumulative "Devices · fleet" KPI to
  // its left.
  const liveServers = useLiveStats((s) => s.servers)
  const onlineNow = useMemo(
    () =>
      Object.values(liveServers).reduce(
        (acc, srv) => acc + (srv?.onlineCount ?? 0),
        0,
      ),
    [liveServers],
  )

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 01"
          title="Overview"
          sub="health · users · activity · trust surfaces"
          right={
            <div className="flex items-center gap-2">
              <Button
                variant={maintOn ? "destructive" : "outline"}
                onClick={() => setMaintM.mutate(!maintOn)}
                disabled={setMaintM.isPending || maintQ.isLoading}
              >
                {maintOn ? "● Maintenance ON" : "Toggle maintenance"}
              </Button>
              <WithTooltip
                side="bottom"
                label={
                  <div className="max-w-xs space-y-1.5 font-mono text-[11px] leading-snug">
                    <p>
                      <span className="font-semibold">Maintenance mode</span>{" "}
                      flips a site-wide kill-switch.
                    </p>
                    <p>
                      When ON, the API rejects non-admin writes with{" "}
                      <code className="rounded-sm bg-amber-400/20 px-1 py-px font-semibold text-amber-300">
                        503
                      </code>{" "}
                      and the UI shows a banner. Admin sessions stay
                      functional so you can still recover.
                    </p>
                    <p className="text-background/60">
                      Reads continue normally · WS streams continue · existing
                      WG tunnels are untouched.
                    </p>
                  </div>
                }
              >
                <button
                  type="button"
                  aria-label="About maintenance mode"
                  className="text-muted-foreground hover:text-foreground focus-visible:text-foreground inline-flex size-7 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <IconInfoCircle className="size-4" />
                </button>
              </WithTooltip>
            </div>
          }
        />
      </StaggerItem>

      <StaggerItem>
        <KpiStrip>
          <Kpi
            label="Users · total"
            value={statsQ.isLoading ? "—" : total}
            footL={`${active} active${pending > 0 ? ` · ${pending} pending` : ""}`}
            footR={suspended > 0 ? `${suspended} suspended` : undefined}
            deltaTone={suspended > 0 ? "dn" : undefined}
          />
          <Kpi
            label="Devices · fleet"
            value={statsQ.isLoading ? "—" : totalDevices}
            footL="WireGuard peers · non-revoked"
          />
          <Kpi
            label="Fleet bandwidth · total"
            value={fleetBwQ.isLoading ? "—" : formatBytes(fleetRx + fleetTx)}
            footL={`RX ${formatBytes(fleetRx)} · TX ${formatBytes(fleetTx)}`}
          />
          <Kpi
            label="Online · now"
            value={statsQ.isLoading ? "—" : onlineNow}
            unit={totalDevices > 0 ? `/ ${totalDevices}` : undefined}
            footL={
              maintOn
                ? "writes blocked · maintenance ON"
                : "live handshakes · fleet"
            }
            footR={maintOn ? "● maintenance" : undefined}
          />
        </KpiStrip>
      </StaggerItem>

      {(serversQ.data ?? []).length > 0 && (
        <StaggerItem>
          <Panel
            title="Server live"
            sub="Last 5 minutes · streamed over WS · seeded from server_samples on mount"
            right={<LiveIndicator />}
            flush
          >
            <div className="flex flex-col">
              {(serversQ.data ?? []).map((srv, i) => (
                <ServerLiveCard
                  key={srv.id}
                  server={srv}
                  divider={i > 0}
                />
              ))}
            </div>
          </Panel>
        </StaggerItem>
      )}

    </PageStagger>
  )
}

function ServerLiveCard({
  server,
  divider,
}: {
  server: AdminServerRow
  divider: boolean
}) {
  const live = useLiveStats((s) => s.servers[server.id])
  const reduceMotion = useReducedMotion()

  // Drive a "tick freshness" indicator off the latest server_sample.
  // Re-renders every second so "updated 3s ago" stays current even when
  // no new data is arriving (which is itself useful info — a stale value
  // means the worker stopped emitting).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const lastTs = live?.lastTs ?? 0
  const ageSec = lastTs ? Math.max(0, Math.floor((now - lastTs) / 1000)) : null
  const isFresh = ageSec !== null && ageSec <= 3
  const isStale = ageSec !== null && ageSec > 30

  return (
    <div
      className={`flex flex-col gap-4 p-5 ${divider ? "border-border border-t" : ""}`}
    >
      {/* Header — server identity + live freshness pill on the right */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="border-border bg-muted/40 flex size-8 shrink-0 items-center justify-center border">
            <IconServer className="text-muted-foreground size-4" />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-foreground truncate font-mono text-sm font-medium">
              {server.name}
            </span>
            <span className="text-muted-foreground truncate font-mono text-[11px]">
              {server.region} · {server.endpoint_host}:{server.endpoint_port}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FreshnessPill
            ageSec={ageSec}
            isFresh={isFresh}
            isStale={isStale}
          />
          <Pill tone={server.is_active ? "ok" : "warn"} dot={false}>
            {server.is_active ? "active" : "disabled"}
          </Pill>
        </div>
      </div>

      {/* KPI strip — 5 metrics in a row. Each value pop-animates when it
          changes so live updates are visually obvious instead of silently
          swapping the number. */}
      <div className="border-border grid grid-cols-2 border md:grid-cols-5">
        <LiveStat
          label="Peers"
          value={live?.peerCount ?? 0}
          icon={<IconUsers className="size-3.5" />}
          reduceMotion={reduceMotion}
        />
        <LiveStat
          label="Online"
          value={live?.onlineCount ?? 0}
          icon={<IconActivity className="size-3.5" />}
          tone={live?.onlineCount ? "ok" : "neutral"}
          reduceMotion={reduceMotion}
        />
        <LiveStat
          label="Hshakes/s"
          value={live?.handshakeCount ?? 0}
          icon={<IconBolt className="size-3.5" />}
          reduceMotion={reduceMotion}
        />
        <LiveStat
          label="Down"
          value={formatBps(live?.rxBps ?? 0)}
          icon={<IconArrowDown className="size-3.5 text-[var(--chart-1)]" />}
          reduceMotion={reduceMotion}
        />
        <LiveStat
          label="Up"
          value={formatBps(live?.txBps ?? 0)}
          icon={<IconArrowUp className="size-3.5 text-primary" />}
          reduceMotion={reduceMotion}
        />
      </div>

      {/* Big chart — pinned 5-min window, time labels along the X axis. */}
      <div className="relative">
        <NetworkMonitorChart
          rxHistory={live?.rxHistory ?? []}
          txHistory={live?.txHistory ?? []}
          height={240}
          windowSec={SERVER_LIVE_WINDOW_SEC}
        />
        {/* Live legend overlay — top-right of the chart. Two coloured
            dots labelling RX and TX so users don't have to hover the
            tooltip to read the series. */}
        <div className="text-muted-foreground absolute right-2 top-1 flex items-center gap-3 font-mono text-[10px]">
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block size-2"
              style={{ background: "var(--chart-1)" }}
            />
            RX
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block size-2"
              style={{ background: "var(--primary)" }}
            />
            TX
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Inline KPI cell with a pop-in transition on value change. Wrapping
 * the displayed value in `<AnimatePresence mode="popLayout">` swaps in
 * each new number with a brief fade+rise so live updates are visually
 * announced without being noisy. Honors prefers-reduced-motion.
 */
function LiveStat({
  label,
  value,
  icon,
  tone = "neutral",
  reduceMotion,
}: {
  label: string
  value: number | string
  icon?: React.ReactNode
  tone?: "ok" | "neutral"
  reduceMotion: boolean | null
}) {
  return (
    <div className="border-border flex flex-col gap-1 border-r p-3 last:border-r-0 [&:nth-child(2n)]:border-r-0 md:[&:nth-child(2n)]:border-r md:last:border-r-0">
      <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide">
        {icon}
        {label}
      </span>
      <div className="overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={String(value)}
            initial={
              reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }
            }
            animate={{ opacity: 1, y: 0 }}
            exit={
              reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }
            }
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`block font-mono text-base tabular-nums ${tone === "ok" ? "text-status-online" : "text-foreground"}`}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  )
}

/**
 * Right-aligned freshness indicator. Pulses green for ≤3 s after a tick
 * lands, fades to muted when stale, hidden until the first sample.
 */
function FreshnessPill({
  ageSec,
  isFresh,
  isStale,
}: {
  ageSec: number | null
  isFresh: boolean
  isStale: boolean
}) {
  if (ageSec === null) {
    return (
      <span className="text-muted-foreground/70 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide">
        <span className="size-1.5 rounded-full bg-amber-500/60" />
        waiting
      </span>
    )
  }
  const tone = isFresh
    ? "text-emerald-600 dark:text-emerald-400"
    : isStale
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground"
  const dotTone = isFresh
    ? "bg-emerald-500"
    : isStale
      ? "bg-amber-500"
      : "bg-muted-foreground/60"
  const label =
    ageSec === 0
      ? "now"
      : ageSec < 60
        ? `${ageSec}s ago`
        : `${Math.round(ageSec / 60)}m ago`
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide ${tone}`}
    >
      <span
        className={`size-1.5 rounded-full ${dotTone} ${isFresh ? "animate-pulse" : ""}`}
      />
      {label}
    </span>
  )
}

