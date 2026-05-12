import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconInfoCircle } from "@tabler/icons-react"
import { useMemo } from "react"
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
import { formatBps, formatBytes } from "@/lib/units"
import { useLiveStats } from "@/stores/liveStats"

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

  const servers = serversQ.data ?? []
  const liveHubs = servers.filter((s) => s.is_active).length

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
            label="Hubs · backbone"
            value={serversQ.isLoading ? "—" : liveHubs}
            unit={servers.length > 0 ? `/ ${servers.length}` : undefined}
            footL={
              maintOn
                ? "writes blocked · maintenance ON"
                : `${liveHubs}/${servers.length} reachable`
            }
            footR={maintOn ? "● maintenance" : undefined}
          />
        </KpiStrip>
      </StaggerItem>

      {(serversQ.data ?? []).length > 0 && (
        <StaggerItem>
        <Panel
          title="Server live"
          sub="per-tick RX/TX + peer counts streamed over WS, hydrated from server_samples"
          right={<LiveIndicator />}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {(serversQ.data ?? []).map((srv) => (
              <ServerLiveCard key={srv.id} server={srv} />
            ))}
          </div>
        </Panel>
        </StaggerItem>
      )}

    </PageStagger>
  )
}

function ServerLiveCard({ server }: { server: AdminServerRow }) {
  const live = useLiveStats((s) => s.servers[server.id])
  return (
    <div className="border-border bg-card rounded-md border p-4">
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <div className="flex flex-col">
          <span className="text-foreground font-mono text-sm font-medium">
            {server.name}
          </span>
          <span className="text-muted-foreground font-mono text-[11px]">
            {server.region} · {server.endpoint_host}:{server.endpoint_port}
          </span>
        </div>
        <Pill tone={server.is_active ? "ok" : "warn"} dot={false}>
          {server.is_active ? "active" : "disabled"}
        </Pill>
      </div>

      <div className="grid grid-cols-3 gap-3 pb-3 font-mono text-[11px]">
        <KpiInline label="Peers" value={live?.peerCount ?? 0} />
        <KpiInline label="Online" value={live?.onlineCount ?? 0} />
        <KpiInline label="Hshakes/s" value={live?.handshakeCount ?? 0} />
      </div>

      <NetworkMonitorChart
        rxHistory={live?.rxHistory ?? []}
        txHistory={live?.txHistory ?? []}
        height={140}
      />

      <div className="text-muted-foreground flex items-center justify-between pt-2 font-mono text-[11px] tabular-nums">
        <span>
          <span className="text-status-online">↓</span>{" "}
          {formatBps(live?.rxBps ?? 0)}
        </span>
        <span>
          <span className="text-primary">↑</span>{" "}
          {formatBps(live?.txBps ?? 0)}
        </span>
      </div>
    </div>
  )
}

function KpiInline({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground uppercase tracking-wide text-[10px]">
        {label}
      </span>
      <span className="text-foreground text-sm">{value}</span>
    </div>
  )
}

