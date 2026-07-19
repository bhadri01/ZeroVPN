import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { LiveIndicator } from "@/components/charts/LazyNetworkMonitorChart"
import { PageStagger, StaggerItem } from "@/components/motion"
import { PageHead, Panel } from "@/components/swiss"
import { FlowTopology } from "@/components/topology/FlowTopology"
import { LiveTopology } from "@/components/topology/LiveTopology"
import { Button } from "@/components/ui/button"
import {
  adminListConnections,
  adminListDevices,
  adminListServers,
  adminListUsers,
} from "@/lib/api"
import { useLiveStats } from "@/stores/liveStats"

type TopologyMode = "devices" | "flows"

const LIVE_ONLY_STORAGE_KEY = "zerovpn.topology.liveOnly.v1"

function readLiveOnly(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(LIVE_ONLY_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function writeLiveOnly(v: boolean): void {
  if (typeof window === "undefined") return
  try {
    if (v) window.localStorage.setItem(LIVE_ONLY_STORAGE_KEY, "1")
    else window.localStorage.removeItem(LIVE_ONLY_STORAGE_KEY)
  } catch {
    // ignore — private mode / quota
  }
}

export function AdminTopologyPage() {
  const [mode, setMode] = useState<TopologyMode>("devices")
  // Live-only toggle: when on, the graph hides peers that aren't
  // currently connected (no recent WG handshake / no peer-sourced
  // flow), so what remains is exactly "who's on the VPN right now".
  // Persisted in localStorage so the admin's choice survives reloads.
  const [liveOnly, setLiveOnly] = useState<boolean>(() => readLiveOnly())
  useEffect(() => {
    writeLiveOnly(liveOnly)
  }, [liveOnly])
  // Fleet-wide device list. Each row carries its owning `user_id`, which
  // LiveTopology uses to group devices under their user node on the
  // inner ring. WS-driven invalidation is the primary live-update path
  // (see LiveStatsProvider); the 10 s safety-net refetch picks up
  // anything a dropped WS frame missed so the topology stays current
  // without needing a manual refresh.
  const devicesQ = useQuery({
    queryKey: ["admin", "devices"],
    queryFn: adminListDevices,
    refetchInterval: 10_000,
  })
  // Pull a large slice of users so we can label every user-tier node.
  // 500 covers any realistic small/medium deployment without paginating
  // here; LiveTopology already caps the visible user-tier at MAX_USERS.
  const usersQ = useQuery({
    queryKey: ["admin", "users", "for-topology"],
    queryFn: () => adminListUsers(undefined, 500, 0),
  })
  // Pick the first server as the hub identity. Single-server deployments
  // are the norm today — when multi-server lands this can switch to a
  // selector.
  const serversQ = useQuery({
    queryKey: ["admin", "servers"],
    queryFn: adminListServers,
  })

  const liveDevices = useLiveStats((s) => s.devices)
  const rates = useMemo(() => {
    const m = new Map<string, { rxBps: number; txBps: number }>()
    for (const [id, d] of Object.entries(liveDevices)) {
      m.set(id, { rxBps: d.rxBps, txBps: d.txBps })
    }
    return m
  }, [liveDevices])

  const devices = useMemo(() => devicesQ.data ?? [], [devicesQ.data])
  const server = serversQ.data?.[0]
  const serverLabel = server?.endpoint_host ?? "vpn-server"
  const serverMeta = server
    ? `${server.cidr} · :${server.endpoint_port}`
    : undefined

  // Build the `user_id → label` map from the admin user list. The label
  // is the local-part of the email so the graph stays readable; if a
  // device's user_id isn't found in the map (e.g. the user list page
  // didn't include them) LiveTopology falls back to a short uuid prefix.
  const userMap = useMemo(() => {
    const m = new Map<string, { label: string }>()
    for (const u of usersQ.data?.items ?? []) {
      m.set(u.id, { label: u.email.split("@")[0] })
    }
    return m
  }, [usersQ.data])

  const uniqueUsers = useMemo(
    () => new Set(devices.map((d) => d.user_id)).size,
    [devices]
  )

  // Fleet-wide active flows. New conntrack entries aren't WS-pushed, so
  // a tight poll is the live-update mechanism in Flows mode — 1.5 s is
  // tight enough that a new flow shows up almost instantly and the
  // per-tick cost (one conntrack read on api-dev + small JSON) stays
  // cheap. Idle when Devices mode is up so conntrack isn't shelled out
  // for nothing.
  const flowsQ = useQuery({
    queryKey: ["admin", "connections"],
    queryFn: adminListConnections,
    enabled: mode === "flows",
    refetchInterval: mode === "flows" ? 1500 : false,
  })
  const flows = flowsQ.data ?? []

  return (
    <PageStagger className="h-full">
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 07"
          title="Topology"
          sub="fleet-wide live view · all users · all devices"
        />
      </StaggerItem>

      <StaggerItem>
        <Panel
          title="Live topology"
          sub={
            mode === "devices"
              ? `${uniqueUsers} ${uniqueUsers === 1 ? "user" : "users"} · ${devices.length} ${devices.length === 1 ? "device" : "devices"}`
              : `${flows.length} ${flows.length === 1 ? "flow" : "flows"} · live conntrack`
          }
          right={
            <div className="flex items-center gap-2">
              <LiveOnlyToggle on={liveOnly} onChange={setLiveOnly} />
              <ModeToggle mode={mode} onChange={setMode} />
              <LiveIndicator />
            </div>
          }
          bodyClassName="relative overflow-hidden !flex-none !p-0 !min-h-[360px] sm:!min-h-[480px] !h-[calc(100svh-180px)] sm:!h-[calc(100svh-220px)]"
        >
          {mode === "devices" ? (
            <LiveTopology
              devices={devices}
              rates={rates}
              serverLabel={serverLabel}
              serverMeta={serverMeta}
              userMap={userMap}
              liveOnly={liveOnly}
            />
          ) : (
            <FlowTopology
              flows={flows}
              serverLabel={serverLabel}
              loading={flowsQ.isLoading}
              liveOnly={liveOnly}
            />
          )}
        </Panel>
      </StaggerItem>
    </PageStagger>
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: TopologyMode
  onChange: (m: TopologyMode) => void
}) {
  return (
    <div className="flex items-center border border-border">
      {(["devices", "flows"] as const).map((m) => (
        <Button
          key={m}
          size="sm"
          variant={mode === m ? "default" : "ghost"}
          onClick={() => onChange(m)}
          className="h-7 rounded-none px-2 font-mono text-[10px] tracking-wider uppercase"
        >
          {m}
        </Button>
      ))}
    </div>
  )
}

/** Filter the topology to just the peers that are currently on the VPN
 *  (Devices mode → recent WG handshake; Flows mode → peer-sourced
 *  conntrack entries). Off shows every peer regardless of state, which
 *  is helpful for fleet planning; on shows "who's connected right now". */
function LiveOnlyToggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Button
      size="sm"
      variant={on ? "default" : "outline"}
      onClick={() => onChange(!on)}
      className="h-7 gap-1.5 px-2 font-mono text-[10px] tracking-wider uppercase"
      title={
        on
          ? "Showing only peers currently connected to the VPN"
          : "Showing every peer regardless of connection state"
      }
    >
      <span
        className={`size-1.5 rounded-full ${on ? "animate-pulse bg-status-online" : "bg-muted-foreground/40"}`}
      />
      Live only
    </Button>
  )
}
