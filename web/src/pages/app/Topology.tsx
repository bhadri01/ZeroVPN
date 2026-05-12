import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { LiveIndicator } from "@/components/charts/LazyNetworkMonitorChart"
import { PageStagger, StaggerItem } from "@/components/motion"
import { PageHead, Panel } from "@/components/swiss"
import { LiveTopology } from "@/components/topology/LiveTopology"
import { listDevices, meServer } from "@/lib/api"
import { useAuth } from "@/stores/auth"
import { useLiveStats } from "@/stores/liveStats"

export function TopologyPage() {
  const user = useAuth((s) => s.user)
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
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

  return (
    <PageStagger className="h-full">
      <StaggerItem>
        <PageHead eyebrow="Workspace · 04" title="Topology" />
      </StaggerItem>

      <StaggerItem>
        <Panel
          title="Live topology"
          sub={`${devices.length} ${devices.length === 1 ? "device" : "devices"}`}
          right={<LiveIndicator />}
          bodyClassName="!p-0 !h-[calc(100vh-220px)] !min-h-[480px] !flex-none relative overflow-hidden"
        >
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
          />
        </Panel>
      </StaggerItem>
    </PageStagger>
  )
}
