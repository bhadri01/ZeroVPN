import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useParams } from "react-router"
import { toast } from "sonner"

import { BandwidthChart } from "@/components/charts/LazyBandwidthChart"
import { CopyableCode } from "@/components/CopyableCode"
import { PageHeader } from "@/components/PageHeader"
import { RelativeTime } from "@/components/RelativeTime"
import { StatusPill } from "@/components/StatusPill"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  ApiError,
  type BandwidthRange,
  deviceBandwidth,
  getDevice,
  patchDevice,
  setDeviceDns,
} from "@/lib/api"
import type { Status } from "@/components/StatusPill"

const FULL_TUNNEL_PRESET = ["0.0.0.0/0", "::/0"]

export function DeviceDetailPage() {
  const { id = "" } = useParams()
  const qc = useQueryClient()
  const deviceQ = useQuery({
    queryKey: ["device", id],
    queryFn: () => getDevice(id),
    enabled: id.length > 0,
  })

  const [bwRange, setBwRange] = useState<BandwidthRange>("24h")
  const bwQ = useQuery({
    queryKey: ["device-bw", id, bwRange],
    queryFn: () => deviceBandwidth(id, bwRange),
    enabled: id.length > 0,
    staleTime: 60_000,
  })

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

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent className="-mt-2 text-sm">
            <StatusPill status={d.status as Status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              IP address
            </CardTitle>
          </CardHeader>
          <CardContent className="-mt-2 font-mono text-sm">
            {d.allocated_ip}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Last handshake
            </CardTitle>
          </CardHeader>
          <CardContent className="-mt-2 text-sm">
            <RelativeTime value={d.last_handshake_at} fallback="Never" />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="bandwidth">
        <TabsList>
          <TabsTrigger value="bandwidth">Bandwidth</TabsTrigger>
          <TabsTrigger value="tunnel">Tunnel & DNS</TabsTrigger>
          <TabsTrigger value="dns-names">DNS names</TabsTrigger>
        </TabsList>

        <TabsContent value="bandwidth" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Bandwidth</CardTitle>
                <CardDescription>RX and TX over time.</CardDescription>
              </div>
              <Tabs
                value={bwRange}
                onValueChange={(v) => setBwRange(v as BandwidthRange)}
              >
                <TabsList className="h-7">
                  <TabsTrigger value="24h" className="text-xs">
                    24h
                  </TabsTrigger>
                  <TabsTrigger value="7d" className="text-xs">
                    7d
                  </TabsTrigger>
                  <TabsTrigger value="30d" className="text-xs">
                    30d
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <BandwidthChart buckets={bwQ.data?.buckets ?? []} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tunnel" className="mt-4 space-y-4">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Custom DNS</CardTitle>
              <CardDescription>
                Override the server-default DNS for this device only.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="dns">DNS servers</Label>
                <Input
                  id="dns"
                  value={customDns}
                  onChange={(e) => setCustomDns(e.target.value)}
                  placeholder="1.1.1.1, 9.9.9.9"
                  className="font-mono"
                />
                <p className="text-muted-foreground text-xs">
                  Leave empty to use the server's DNS (recommended).
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
        </TabsContent>

        <TabsContent value="dns-names" className="mt-4">
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
        </TabsContent>
      </Tabs>

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
