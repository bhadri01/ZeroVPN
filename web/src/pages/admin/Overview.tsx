import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconSearch } from "@tabler/icons-react"
import { useMemo, useState } from "react"
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
  adminGetMaintenance,
  adminListServers,
  adminListUsers,
  adminSetMaintenance,
  adminSetUserStatus,
} from "@/lib/api"
import { formatBps } from "@/lib/units"
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
  const usersQ = useQuery({
    queryKey: ["admin", "users", search],
    queryFn: () => adminListUsers(search || undefined),
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
  const total = usersQ.data?.total ?? 0
  const active = items.filter((u) => u.status === "active").length
  const suspended = items.filter((u) => u.status === "suspended").length
  const totalDevices = items.reduce((s, u) => s + u.device_count, 0)
  const maintOn = !!maintQ.data?.maintenance_mode

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
        <Kpi label="Total users" value={total} footL={`${active} active`} />
        <Kpi
          label="Suspended"
          value={suspended}
          footL="locked out"
          deltaTone={suspended > 0 ? "dn" : undefined}
        />
        <Kpi label="Devices" value={totalDevices} footL="WireGuard peers" />
        <Kpi
          label="Maintenance"
          value={maintOn ? "ON" : "OFF"}
          footL={maintOn ? "writes blocked" : "writes allowed"}
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
        sub={`${total.toLocaleString()} total · search, suspend, unsuspend`}
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
