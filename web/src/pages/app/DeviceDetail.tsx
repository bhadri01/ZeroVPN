import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useParams } from "react-router"
import { toast } from "sonner"

import {
  LiveIndicator,
  NetworkMonitorChart,
} from "@/components/charts/LazyNetworkMonitorChart"
import { CopyableCode } from "@/components/CopyableCode"
import { PageHeader } from "@/components/PageHeader"
import { RelativeTime } from "@/components/RelativeTime"
import { Stat } from "@/components/Stat"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useBreadcrumbOverride } from "@/hooks/useBreadcrumbOverride"
import {
  ApiError,
  getDevice,
  patchDevice,
  setDeviceDns,
} from "@/lib/api"
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

  // Push the actual device name into the breadcrumb in place of "Device".
  useBreadcrumbOverride(deviceQ.data?.name)

  const live = useLiveStats((s) => s.devices[id])

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
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  const d = deviceQ.data
  const rxHistory = live?.rxHistory ?? []
  const txHistory = live?.txHistory ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title={d.name}
        description={
          <>
            {d.os} · {d.allocated_ip}
          </>
        }
        actions={<StatusPill status={d.status as Status} />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="IP" value={0} format={() => d.allocated_ip} hint="WireGuard address" />
        <Stat
          label="RX rate"
          value={live?.rxBps ?? 0}
          format={formatBps}
          hint="now"
        />
        <Stat
          label="TX rate"
          value={live?.txBps ?? 0}
          format={formatBps}
          hint="now"
        />
        <LastHandshakeStat ts={d.last_handshake_at} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Combined RX + TX</CardTitle>
              <CardDescription>Last 60 frames</CardDescription>
            </div>
            <LiveIndicator />
          </CardHeader>
          <CardContent>
            <NetworkMonitorChart
              rxHistory={rxHistory}
              txHistory={txHistory}
              variant="combined"
              height={180}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">RX</CardTitle>
              <CardDescription>Inbound</CardDescription>
            </div>
            <LiveIndicator />
          </CardHeader>
          <CardContent>
            <NetworkMonitorChart
              rxHistory={rxHistory}
              txHistory={[]}
              variant="rx"
              height={180}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">TX</CardTitle>
              <CardDescription>Outbound</CardDescription>
            </div>
            <LiveIndicator />
          </CardHeader>
          <CardContent>
            <NetworkMonitorChart
              rxHistory={[]}
              txHistory={txHistory}
              variant="tx"
              height={180}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Routing</CardTitle>
            <CardDescription>
              Choose what traffic is sent through the tunnel. Re-download
              the .conf afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={tunnel === "full" ? "default" : "outline"}
                onClick={() => setTunnel("full")}
              >
                Full tunnel
              </Button>
              <Button
                size="sm"
                variant={tunnel === "split" ? "default" : "outline"}
                onClick={() => setTunnel("split")}
              >
                Split tunnel
              </Button>
            </div>
            {tunnel === "split" && (
              <div className="space-y-1.5">
                <Label htmlFor="cidrs">Allowed CIDRs</Label>
                <Input
                  id="cidrs"
                  value={splitCidrs}
                  onChange={(e) => setSplitCidrs(e.target.value)}
                  placeholder="10.0.0.0/8, 192.168.0.0/16"
                  className="font-mono"
                />
                <p className="text-muted-foreground text-xs">
                  Only listed networks will be tunnelled.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="dns">Custom DNS (optional)</Label>
              <Input
                id="dns"
                value={customDns}
                onChange={(e) => setCustomDns(e.target.value)}
                placeholder="1.1.1.1, 9.9.9.9"
                className="font-mono"
              />
              <p className="text-muted-foreground text-xs">
                Leave empty to use the server's DNS.
              </p>
            </div>
            <Button
              onClick={() => saveTunnelM.mutate()}
              disabled={saveTunnelM.isPending}
            >
              {saveTunnelM.isPending ? "Saving…" : "Save tunnel + DNS"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">DNS names</CardTitle>
            <CardDescription>
              Reach this peer from other peers via{" "}
              <code className="bg-muted rounded px-1 text-xs">
                name.vpn.local
              </code>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dns-names">Hostnames</Label>
              <Input
                id="dns-names"
                value={dnsNames}
                onChange={(e) => setDnsNames(e.target.value)}
                placeholder="laptop.vpn.local, work-laptop.vpn.local"
                className="font-mono"
              />
            </div>
            <Button
              onClick={() => saveDnsNamesM.mutate()}
              disabled={saveDnsNamesM.isPending}
            >
              {saveDnsNamesM.isPending ? "Saving…" : "Save DNS names"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Public key</CardTitle>
          <CardDescription>The peer's WireGuard pubkey.</CardDescription>
        </CardHeader>
        <CardContent>
          <CopyableCode value={d.public_key} />
        </CardContent>
      </Card>
    </div>
  )
}

function LastHandshakeStat({
  ts,
}: {
  ts: string | null | undefined
}) {
  return (
    <Card>
      <CardContent className="space-y-1 px-4 py-3">
        <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
          Last handshake
        </p>
        <p className="text-base font-semibold tracking-tight">
          <RelativeTime value={ts} fallback="Never" />
        </p>
        <p className="text-muted-foreground text-xs">tunnel keepalive</p>
      </CardContent>
    </Card>
  )
}

function formatBps(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}
