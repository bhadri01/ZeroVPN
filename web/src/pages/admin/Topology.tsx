import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { LiveIndicator } from "@/components/charts/LazyNetworkMonitorChart"
import { PageStagger, StaggerItem } from "@/components/motion"
import { PageHead, Panel } from "@/components/swiss"
import { LiveTopology } from "@/components/topology/LiveTopology"
import { adminListDevices, adminListServers, adminListUsers } from "@/lib/api"
import { useLiveStats } from "@/stores/liveStats"

export function AdminTopologyPage() {
  // Fleet-wide device list. Each row carries its owning `user_id`, which
  // LiveTopology uses to group devices under their user node on the
  // inner ring.
  const devicesQ = useQuery({
    queryKey: ["admin", "devices"],
    queryFn: adminListDevices,
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

  const devices = devicesQ.data ?? []
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
    [devices],
  )

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
          sub={`${uniqueUsers} ${uniqueUsers === 1 ? "user" : "users"} · ${devices.length} ${devices.length === 1 ? "device" : "devices"}`}
          right={<LiveIndicator />}
          bodyClassName="relative overflow-hidden !flex-none !p-0 !min-h-[360px] sm:!min-h-[480px] !h-[calc(100svh-180px)] sm:!h-[calc(100svh-220px)]"
        >
          <LiveTopology
            devices={devices}
            rates={rates}
            serverLabel={serverLabel}
            serverMeta={serverMeta}
            userMap={userMap}
          />
        </Panel>
      </StaggerItem>
    </PageStagger>
  )
}
