import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconSearch } from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  LiveIndicator,
  NetworkMonitorChart,
} from "@/components/charts/LazyNetworkMonitorChart"
import { PageStagger, StaggerItem } from "@/components/motion"
import { RelativeTime } from "@/components/RelativeTime"
import { Kpi, KpiStrip, PageHead, Panel, Pill } from "@/components/swiss"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useHistoryHydration } from "@/hooks/useHistoryHydration"
import {
  ApiError,
  type AdminServerRow,
  type AdminUser,
  type UserStatus,
  adminFleetBandwidth,
  adminGetMaintenance,
  adminListServers,
  adminListUsers,
  adminSetMaintenance,
  adminSetUserStatus,
  adminStats,
} from "@/lib/api"
import { formatBps, formatBytes } from "@/lib/units"
import { useAuth } from "@/stores/auth"
import { useLiveStats } from "@/stores/liveStats"

const USER_STATUS_TO_PILL: Record<UserStatus, Status> = {
  active: "active",
  suspended: "revoked",
  pending_verification: "pending",
  deleted: "offline",
}

export function AdminOverviewPage() {
  const me = useAuth((s) => s.user)
  const qc = useQueryClient()

  const [search, setSearch] = useState("")
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)
  // Reset to page 0 whenever the search term changes — otherwise a
  // narrower query can leave us pointing past the end of the result set.
  useEffect(() => {
    setPage(0)
  }, [search])
  const usersQ = useQuery({
    queryKey: ["admin", "users", search, page],
    queryFn: () => adminListUsers(search || undefined, PAGE_SIZE, page * PAGE_SIZE),
    placeholderData: (prev) => prev,
  })

  // Deployment-wide aggregate counts. Decoupled from the (paginated)
  // users query so the KPI strip reflects the whole fleet, not just
  // whatever page the admin is looking at.
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

  const setStatusM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      adminSetUserStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] })
      toast.success("User status updated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

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

  const items = usersQ.data?.items ?? []
  // Filtered total reported by the API for the current search — drives
  // the pagination strip below. Deployment-wide totals come from
  // `statsQ` so the KPI strip doesn't lie when the user is filtering.
  const filteredTotal = usersQ.data?.total ?? 0
  const stats = statsQ.data
  const total = stats?.total ?? 0
  const active = stats?.active ?? 0
  const suspended = stats?.suspended ?? 0
  const pending = stats?.pending_verification ?? 0
  const totalDevices = stats?.devices_total ?? 0
  const fleetRx = fleetBwQ.data?.rx_bytes ?? 0
  const fleetTx = fleetBwQ.data?.tx_bytes ?? 0
  const fleetWindow = fleetBwQ.data?.window_days ?? 30
  const maintOn = !!maintQ.data?.maintenance_mode

  const servers = serversQ.data ?? []
  const liveHubs = servers.filter((s) => s.is_active).length

  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE))
  const fromIdx = filteredTotal === 0 ? 0 : page * PAGE_SIZE + 1
  const toIdx = Math.min(filteredTotal, page * PAGE_SIZE + items.length)

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 01"
          title="Overview"
          sub="health · users · activity · trust surfaces"
          right={
            <Button
              variant={maintOn ? "destructive" : "outline"}
              onClick={() => setMaintM.mutate(!maintOn)}
              disabled={setMaintM.isPending || maintQ.isLoading}
            >
              {maintOn ? "● Maintenance ON" : "Toggle maintenance"}
            </Button>
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
            label={`Fleet bandwidth · ${fleetWindow}d`}
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

      <StaggerItem>
      <Panel
        title="Maintenance mode"
        sub="When ON, the API rejects writes with 503 and the UI shows a site-wide banner."
        right={
          <Switch
            checked={maintOn}
            onCheckedChange={(v) => setMaintM.mutate(v)}
            disabled={setMaintM.isPending || maintQ.isLoading}
            aria-label="Maintenance mode"
          />
        }
      >
        {maintOn && (
          <p className="text-status-degraded font-mono text-xs">
            Currently ON · all non-admin writes returning 503.
          </p>
        )}
        {!maintOn && (
          <p className="text-muted-foreground font-mono text-xs">
            Toggle on the right to flip the kill-switch.
          </p>
        )}
      </Panel>
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

      <StaggerItem>
      <Panel
        flush
        title="Users"
        sub={
          search
            ? `${filteredTotal.toLocaleString()} match "${search}" · ${total.toLocaleString()} total`
            : `${total.toLocaleString()} total · search, suspend, unsuspend`
        }
        right={
          <div className="relative w-64">
            <IconSearch className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter email…"
              className="h-8 pl-8"
            />
          </div>
        }
      >
        <table className="zv-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>2FA</th>
              <th className="zv-num">Devices</th>
              <th>Last login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                isSelf={u.id === me?.id}
                onSet={(status) => setStatusM.mutate({ id: u.id, status })}
              />
            ))}
            {!usersQ.isLoading && items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="text-muted-foreground py-8 text-center font-mono text-sm"
                >
                  No users match.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination strip — only renders when the result set spills
            past one page. Uses the API-reported `total` so the page
            count stays honest under a filtered search. */}
        {filteredTotal > PAGE_SIZE && (
          <div className="border-border flex items-center justify-between gap-2 border-t px-4 py-2 font-mono text-[11px]">
            <span className="text-muted-foreground tabular-nums">
              {fromIdx.toLocaleString()}–{toIdx.toLocaleString()} of{" "}
              {filteredTotal.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || usersQ.isFetching}
              >
                ← Prev
              </Button>
              <span className="text-muted-foreground tabular-nums">
                page {page + 1} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setPage((p) => Math.min(pageCount - 1, p + 1))
                }
                disabled={page >= pageCount - 1 || usersQ.isFetching}
              >
                Next →
              </Button>
            </div>
          </div>
        )}
      </Panel>
      </StaggerItem>
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

function UserRow({
  u,
  isSelf,
  onSet,
}: {
  u: AdminUser
  isSelf: boolean
  onSet: (status: UserStatus) => void
}) {
  return (
    <tr>
      <td>
        <span className="font-medium">{u.email}</span>
        {isSelf && (
          <span className="text-muted-foreground/60 ml-2 font-mono text-[10px] uppercase">
            you
          </span>
        )}
      </td>
      <td>
        {u.role === "admin" ? (
          <Pill tone="info" dot={false}>
            admin
          </Pill>
        ) : (
          <span className="text-muted-foreground">user</span>
        )}
      </td>
      <td>
        <StatusPill
          status={USER_STATUS_TO_PILL[u.status] ?? "pending"}
          label={u.status.replace(/_/g, " ")}
        />
      </td>
      <td>
        {u.totp_enabled ? (
          <Pill tone="ok" dot={false}>
            on
          </Pill>
        ) : (
          <Pill tone="warn" dot={false}>
            off
          </Pill>
        )}
      </td>
      <td className="zv-num">{u.device_count}</td>
      <td className="text-muted-foreground font-mono text-xs">
        <RelativeTime value={u.last_login_at} fallback="Never" />
      </td>
      <td className="zv-actions">
        {!isSelf && u.status === "active" && (
          <Button size="sm" variant="outline" onClick={() => onSet("suspended")}>
            Suspend
          </Button>
        )}
        {!isSelf && u.status === "suspended" && (
          <Button size="sm" onClick={() => onSet("active")}>
            Unsuspend
          </Button>
        )}
      </td>
    </tr>
  )
}
