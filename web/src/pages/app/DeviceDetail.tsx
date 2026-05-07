import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { BandwidthChart } from "@/components/charts/BandwidthChart"
import { Button } from "@/components/ui/button"
import {
  ApiError,
  type BandwidthRange,
  deviceBandwidth,
  getDevice,
  patchDevice,
  setDeviceDns,
} from "@/lib/api"

const FULL_TUNNEL_PRESET = ["0.0.0.0/0", "::/0"]

export function DeviceDetailPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
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

  // Local form state for split-tunneling + DNS overrides + DNS names.
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
          FULL_TUNNEL_PRESET.every((p) => d.allowed_ips_override?.includes(p)))
      setTunnel(isFull ? "full" : "split")
      setSplitCidrs(
        isFull ? "" : (d.allowed_ips_override ?? []).join(", "),
      )
      setCustomDns("") // dns_override not exposed in PublicDevice; reset
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
      toast.success("Device updated — re-download .conf for changes to take effect")
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
      <div className="text-muted-foreground flex min-h-svh items-center justify-center">
        Loading…
      </div>
    )
  }
  const d = deviceQ.data

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">{d.name}</h1>
        <Button asChild variant="ghost" size="sm">
          <Link to="/app">Back</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 p-6">
        <section className="space-y-1 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">Status</p>
          <p>
            <strong>{d.status}</strong> · {d.os} · {d.allocated_ip}
          </p>
          <p className="text-muted-foreground text-xs">
            Last handshake:{" "}
            {d.last_handshake_at
              ? new Date(d.last_handshake_at).toLocaleString()
              : "Never"}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Bandwidth</h2>
          <div className="flex gap-1">
            {(["24h", "7d", "30d"] as BandwidthRange[]).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={r === bwRange ? "default" : "outline"}
                onClick={() => setBwRange(r)}
              >
                {r}
              </Button>
            ))}
          </div>
          <BandwidthChart buckets={bwQ.data?.buckets ?? []} />
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Tunnel & DNS</h2>
          <p className="text-muted-foreground text-sm">
            Changes apply on next config download — re-import the .conf into
            your client.
          </p>

          <div className="space-y-2">
            <label className="text-sm font-medium">Routing</label>
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
              <input
                value={splitCidrs}
                onChange={(e) => setSplitCidrs(e.target.value)}
                placeholder="10.0.0.0/8, 192.168.0.0/16"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            )}
            <p className="text-muted-foreground text-xs">
              CIDR list (comma-separated). Only listed networks will be sent
              through the tunnel.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Custom DNS (optional)</label>
            <input
              value={customDns}
              onChange={(e) => setCustomDns(e.target.value)}
              placeholder="1.1.1.1, 9.9.9.9"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <p className="text-muted-foreground text-xs">
              Overrides the server-default DNS. Leave empty to use the server's
              DNS (recommended for ad-blocking / split-DNS).
            </p>
          </div>

          <Button
            onClick={() => saveTunnelM.mutate()}
            disabled={saveTunnelM.isPending}
          >
            {saveTunnelM.isPending ? "Saving…" : "Save tunnel + DNS"}
          </Button>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">DNS names</h2>
          <p className="text-muted-foreground text-sm">
            Reach this peer from other peers as <code>name.vpn.local</code>.
          </p>
          <input
            value={dnsNames}
            onChange={(e) => setDnsNames(e.target.value)}
            placeholder="laptop.vpn.local, work-laptop.vpn.local"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          <Button
            onClick={() => saveDnsNamesM.mutate()}
            disabled={saveDnsNamesM.isPending}
          >
            {saveDnsNamesM.isPending ? "Saving…" : "Save DNS names"}
          </Button>
        </section>

        <section>
          <Button variant="ghost" onClick={() => navigate("/app")}>
            Back to dashboard
          </Button>
        </section>
      </main>
    </div>
  )
}
