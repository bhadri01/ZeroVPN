import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { LiveIndicator } from "@/components/charts/LiveIndicator"
import { PageStagger, StaggerItem } from "@/components/motion"
import { PageHead, Panel } from "@/components/swiss"
import { FlowTopology } from "@/components/topology/FlowTopology"
import { LiveTopology } from "@/components/topology/LiveTopology"
import { Button } from "@/components/ui/button"
import { listConnections, listDevices, meServer } from "@/lib/api"
import { useAuth } from "@/stores/auth"
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

export function TopologyPage() {
  const user = useAuth((s) => s.user)
  const [mode, setMode] = useState<TopologyMode>("devices")
  // Live-only toggle: when on, only show peers currently connected to
  // the VPN (recent WG handshake in Devices, peer-sourced conntrack
  // entries in Flows). Persisted across reloads via localStorage —
  // shares the same key as the admin page so the two views agree.
  const [liveOnly, setLiveOnly] = useState<boolean>(() => readLiveOnly())
  useEffect(() => {
    writeLiveOnly(liveOnly)
  }, [liveOnly])
  // Device list — WS-driven invalidation (see LiveStatsProvider) is the
  // primary live-update path; the 10 s safety-net refetch picks up
  // anything a dropped WS frame missed so the topology stays current
  // without needing a manual refresh.
  const devicesQ = useQuery({
    queryKey: ["devices"],
    queryFn: listDevices,
    refetchInterval: 10_000,
  })
  // The VPN hub identity is the same for every user on a given deployment
  // (one WireGuard server backs the whole fleet), so it must come from the
  // server, never from the viewer's email — using the email domain made
  // accounts like bhadri2002@example.com render the hub as "example.com".
  const serverQ = useQuery({ queryKey: ["me", "server"], queryFn: meServer })

  const liveDevices = useLiveStats((s) => s.devices)
  const rates = useMemo(() => {
    const m = new Map<string, { rxBps: number; txBps: number }>()
    for (const [id, d] of Object.entries(liveDevices)) {
      m.set(id, { rxBps: d.rxBps, txBps: d.txBps })
    }
    return m
  }, [liveDevices])

  const devices = devicesQ.data ?? []
  const server = serverQ.data
  const serverLabel = server?.endpoint_host ?? "vpn-server"
  const serverMeta = server
    ? `${server.cidr} · :${server.endpoint_port}`
    : undefined

  // Active flows for the caller. Only the user's own devices' flows are
  // returned (backend filters by `allocated_ip`). Polled while Flows
  // mode is selected — new conntrack entries aren't WS-pushed, so polling
  // is the live-update mechanism here. 1.5 s is tight enough that a new
  // flow shows up almost instantly and the per-tick cost (one conntrack
  // read + small JSON) stays cheap. Idle when Devices mode is up so
  // conntrack isn't shelled out for nothing.
  const flowsQ = useQuery({
    queryKey: ["connections", "me"],
    queryFn: listConnections,
    enabled: mode === "flows",
    refetchInterval: mode === "flows" ? 1500 : false,
  })
  const flows = flowsQ.data ?? []

  return (
    <PageStagger className="h-full">
      <StaggerItem>
        <PageHead eyebrow="Workspace · 04" title="Topology" />
      </StaggerItem>

      <StaggerItem>
        <Panel
          title="Live topology"
          sub={
            mode === "devices"
              ? `${devices.length} ${devices.length === 1 ? "device" : "devices"}`
              : `${flows.length} ${flows.length === 1 ? "flow" : "flows"}`
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
              // Label the user-tier node with the local-part of the current
              // user's email — short, readable, and matches the rest of the
              // app's "me" identity. The map is keyed by user_id so it scales
              // to multi-user admin topologies later.
              userMap={
                user
                  ? new Map([[user.id, { label: user.email.split("@")[0] }]])
                  : undefined
              }
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

/** Filter the topology to just the peers currently on the VPN. Off
 *  shows every peer regardless of state; on hides anything without a
 *  recent WG handshake (Devices mode) or without a peer-sourced
 *  conntrack flow (Flows mode). */
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
