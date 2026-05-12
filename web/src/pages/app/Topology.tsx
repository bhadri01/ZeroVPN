import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { LiveIndicator } from "@/components/charts/LazyNetworkMonitorChart"
import { PageStagger, StaggerItem } from "@/components/motion"
import { PageHead, Panel } from "@/components/swiss"
import { LiveTopology } from "@/components/topology/LiveTopology"
import { listDevices } from "@/lib/api"
import { useAuth } from "@/stores/auth"
import { useLiveStats } from "@/stores/liveStats"

export function TopologyPage() {
  const user = useAuth((s) => s.user)
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })

  const liveDevices = useLiveStats((s) => s.devices)
  const rates = useMemo(() => {
    const m = new Map<string, { rxBps: number; txBps: number }>()
    for (const [id, d] of Object.entries(liveDevices)) {
      m.set(id, { rxBps: d.rxBps, txBps: d.txBps })
    }
    return m
  }, [liveDevices])

  const devices = devicesQ.data ?? []

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
            serverLabel={user?.email?.split("@")[1] ?? "vpn-server"}
            serverMeta={
              devices.length > 0 && devices[0].allocated_ip
                ? deriveCidr(devices[0].allocated_ip)
                : undefined
            }
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

/** Best-effort CIDR derived from a device's allocated IP. Used purely as
 *  cosmetic meta on the topology hub — falls back to the bare IP if we
 *  can't parse it as IPv4. */
function deriveCidr(ip: string): string | undefined {
  const parts = ip.split(".")
  if (parts.length !== 4) return undefined
  return `${parts[0]}.${parts[1]}.0.0/16`
}
