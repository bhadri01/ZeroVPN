import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useParams } from "react-router"
import { toast } from "sonner"

import {
  LiveIndicator,
  NetworkMonitorChart,
} from "@/components/charts/LazyNetworkMonitorChart"
import { CopyableCode } from "@/components/CopyableCode"
import { RelativeTime } from "@/components/RelativeTime"
import { Kpi, KpiStrip, PageHead, Panel, Seg } from "@/components/swiss"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useBreadcrumbOverride } from "@/hooks/useBreadcrumbOverride"
import { useHistoryHydration } from "@/hooks/useHistoryHydration"
import { ApiError, getDevice, patchDevice, setDeviceDns } from "@/lib/api"
import { formatBps } from "@/lib/units"
import { useLiveStats } from "@/stores/liveStats"

const FULL_TUNNEL_PRESET = ["0.0.0.0/0", "::/0"]

export function DeviceDetailPage() {
  const { id = "" } = useParams()
  const qc = useQueryClient()
  const deviceQ = useQuery({
    queryKey: ["device", id],
    queryFn: () => getDevice(id),
    enabled: id.length > 0,
  })

  useBreadcrumbOverride(deviceQ.data?.name)

  const live = useLiveStats((s) => s.devices[id])

  // Backfill the rolling chart with the last 30 min of tick-level history
  // so a refresh shows real context, not an empty chart. Live WS deltas
  // continue appending on top.
  useHistoryHydration({ deviceIds: id ? [id] : [], windowSec: 1800 })

  const [tunnel, setTunnel] = useState<"full" | "split">("full")
  const [splitCidrs, setSplitCidrs] = useState("")
  const [customDns, setCustomDns] = useState("")
  const [dnsNames, setDnsNames] = useState("")

  useEffect(() => {
    if (deviceQ.data) {
      const d = deviceQ.data
      const isFull =
        !d.allowed_ips_override ||
        d.allowed_ips_override.length === 0 ||
        (d.allowed_ips_override.length === 2 &&
          FULL_TUNNEL_PRESET.every((p) =>
            d.allowed_ips_override?.includes(p),
          ))
      setTunnel(isFull ? "full" : "split")
      setSplitCidrs(isFull ? "" : (d.allowed_ips_override ?? []).join(", "))
      setCustomDns("")
      setDnsNames(d.dns_names.join(", "))
    }
  }, [deviceQ.data])

  const saveTunnelM = useMutation({
    mutationFn: () => {
      const allowed_ips_override =
        tunnel === "full"
          ? FULL_TUNNEL_PRESET
          : splitCidrs
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
      const dns_override =
        customDns.trim().length === 0
          ? null
          : customDns
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
      return patchDevice(id, { allowed_ips_override, dns_override })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["device", id] })
      toast.success("Saved — re-download .conf to apply")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const saveDnsNamesM = useMutation({
    mutationFn: () =>
      setDeviceDns(
        id,
        dnsNames
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["device", id] })
      toast.success("DNS names updated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  if (deviceQ.isLoading || !deviceQ.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48 rounded-none" />
        <Skeleton className="h-32 rounded-none" />
        <Skeleton className="h-64 rounded-none" />
      </div>
    )
  }
  const d = deviceQ.data
  const rxHistory = live?.rxHistory ?? []
  const txHistory = live?.txHistory ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow={`Devices · ${d.id.slice(0, 8).toUpperCase()}`}
        title={d.name}
        sub={`${d.os} · ${d.allocated_ip}`}
        right={<StatusPill status={d.status as Status} />}
      />

      <KpiStrip>
        <Kpi
          label="VPN IP"
          value={<span className="font-mono text-xl">{d.allocated_ip}</span>}
          footL="WireGuard address"
        />
        <Kpi
          label="RX · live"
          value={formatBps(live?.rxBps ?? 0)}
          spark={rxHistory.slice(-32)}
          sparkColor="var(--chart-1)"
          footL={d.status === "active" ? "▲ live" : "—"}
        />
        <Kpi
          label="TX · live"
          value={formatBps(live?.txBps ?? 0)}
          spark={txHistory.slice(-32)}
          sparkColor="var(--primary)"
          footL={d.status === "active" ? "▲ live" : "—"}
        />
        <Kpi
          label="Last handshake"
          value={<RelativeTime value={d.last_handshake_at} fallback="Never" />}
          footL="tunnel keepalive"
        />
      </KpiStrip>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Combined RX + TX"
          sub="Last 60 frames"
          right={<LiveIndicator />}
        >
          <NetworkMonitorChart
            rxHistory={rxHistory}
            txHistory={txHistory}
            variant="combined"
            height={180}
          />
        </Panel>
        <Panel title="RX" sub="Inbound" right={<LiveIndicator />}>
          <NetworkMonitorChart
            rxHistory={rxHistory}
            txHistory={[]}
            variant="rx"
            height={180}
          />
        </Panel>
        <Panel title="TX" sub="Outbound" right={<LiveIndicator />}>
          <NetworkMonitorChart
            rxHistory={[]}
            txHistory={txHistory}
            variant="tx"
            height={180}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Routing"
          sub="Choose what traffic is sent through the tunnel. Re-download the .conf afterwards."
        >
          <div className="flex flex-col gap-3">
            <Seg
              value={tunnel}
              options={[
                { value: "full" as const, label: "Full tunnel" },
                { value: "split" as const, label: "Split tunnel" },
              ]}
              onChange={(v) => setTunnel(v)}
            />
            {tunnel === "split" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cidrs" className="zv-eyebrow">
                  Allowed CIDRs
                </Label>
                <Input
                  id="cidrs"
                  value={splitCidrs}
                  onChange={(e) => setSplitCidrs(e.target.value)}
                  placeholder="10.0.0.0/8, 192.168.0.0/16"
                  className="font-mono"
                />
                <p className="text-muted-foreground font-mono text-[11px]">
                  Only listed networks will be tunnelled.
                </p>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dns" className="zv-eyebrow">
                Custom DNS (optional)
              </Label>
              <Input
                id="dns"
                value={customDns}
                onChange={(e) => setCustomDns(e.target.value)}
                placeholder="1.1.1.1, 9.9.9.9"
                className="font-mono"
              />
              <p className="text-muted-foreground font-mono text-[11px]">
                Leave empty to use the server's DNS.
              </p>
            </div>
            <div>
              <Button
                onClick={() => saveTunnelM.mutate()}
                disabled={saveTunnelM.isPending}
              >
                {saveTunnelM.isPending ? "Saving…" : "Save tunnel + DNS"}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel
          title="DNS names"
          sub={
            <>
              Reach this peer from other peers via{" "}
              <span className="zv-kbd">name.vpn.local</span>.
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dns-names" className="zv-eyebrow">
                Hostnames
              </Label>
              <Input
                id="dns-names"
                value={dnsNames}
                onChange={(e) => setDnsNames(e.target.value)}
                placeholder="laptop.vpn.local, work-laptop.vpn.local"
                className="font-mono"
              />
            </div>
            <div>
              <Button
                onClick={() => saveDnsNamesM.mutate()}
                disabled={saveDnsNamesM.isPending}
              >
                {saveDnsNamesM.isPending ? "Saving…" : "Save DNS names"}
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Public key" sub="The peer's WireGuard pubkey.">
        <CopyableCode value={d.public_key} />
      </Panel>
    </div>
  )
}

