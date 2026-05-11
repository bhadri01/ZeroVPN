import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconDownload,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { LiveIndicator } from "@/components/charts/LazyNetworkMonitorChart"
import { BandwidthChart } from "@/components/charts/BandwidthChart"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { RelativeTime } from "@/components/RelativeTime"
import {
  Eyebrow,
  Kpi,
  KpiStrip,
  PageHead,
  Panel,
  Seg,
  fmtRel,
} from "@/components/swiss"
import { StatusPill } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useBreadcrumbOverride } from "@/hooks/useBreadcrumbOverride"
import { useHistoryHydration } from "@/hooks/useHistoryHydration"
import {
  ApiError,
  type BandwidthRange,
  deleteDevice,
  deviceBandwidth,
  getDevice,
  meServer,
  patchDevice,
  pauseDevice,
  unpauseDevice,
} from "@/lib/api"
import { connState } from "@/lib/deviceState"
import { formatBps } from "@/lib/units"
import { useLiveStats } from "@/stores/liveStats"

const FULL_TUNNEL_PRESET = ["0.0.0.0/0", "::/0"]
const KEEPALIVE_SECS = 25

export function DeviceDetailPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const deviceQ = useQuery({
    queryKey: ["device", id],
    queryFn: () => getDevice(id),
    enabled: id.length > 0,
  })
  const serverQ = useQuery({
    queryKey: ["me", "server"],
    queryFn: meServer,
    staleTime: 5 * 60_000,
  })

  useBreadcrumbOverride(deviceQ.data?.name)

  const live = useLiveStats((s) => s.devices[id])
  // History hydration so the chart shows real context after a refresh.
  useHistoryHydration({ deviceIds: id ? [id] : [], windowSec: 1800 })

  // Bandwidth chart: device-scoped historical buckets, 24h/7d/30d range.
  const [range, setRange] = useState<BandwidthRange>("24h")
  const bwQ = useQuery({
    queryKey: ["bandwidth", "device", id, range],
    queryFn: () => deviceBandwidth(id, range),
    enabled: id.length > 0,
    refetchInterval: range === "24h" ? 30_000 : 5 * 60_000,
  })

  // Edit mode for the Configuration panel — flips between read-only view
  // and an inline form so the panel keeps its shape either way.
  const [editing, setEditing] = useState(false)
  const [tunnel, setTunnel] = useState<"full" | "split">("full")
  const [splitCidrs, setSplitCidrs] = useState("")
  const [customDns, setCustomDns] = useState("")
  const [splitTunnelOn, setSplitTunnelOn] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)

  // Seed edit-form state from the live device payload whenever it changes.
  useEffect(() => {
    if (!deviceQ.data) return
    const d = deviceQ.data
    const isFull =
      !d.allowed_ips_override ||
      d.allowed_ips_override.length === 0 ||
      (d.allowed_ips_override.length === 2 &&
        FULL_TUNNEL_PRESET.every((p) => d.allowed_ips_override?.includes(p)))
    setTunnel(isFull ? "full" : "split")
    setSplitTunnelOn(!isFull)
    setSplitCidrs(isFull ? "" : (d.allowed_ips_override ?? []).join(", "))
    setCustomDns((d.dns_override ?? []).join(", "))
  }, [deviceQ.data])

  const saveConfigM = useMutation({
    mutationFn: () => {
      const allowed_ips_override =
        tunnel === "full"
          ? FULL_TUNNEL_PRESET
          : splitCidrs
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
      const dnsList = customDns
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      return patchDevice(id, {
        allowed_ips_override,
        dns_override: dnsList.length === 0 ? null : dnsList,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["device", id] })
      setEditing(false)
      toast.success("Saved — re-download .conf to apply")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const pauseM = useMutation({
    mutationFn: () => pauseDevice(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["device", id] })
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.info("Device paused")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })
  const unpauseM = useMutation({
    mutationFn: () => unpauseDevice(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["device", id] })
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device active")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })
  const deleteM = useMutation({
    mutationFn: () => deleteDevice(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.warning("Device revoked")
      navigate("/app/devices")
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
  const isOnline = connState(d) === "online"
  const isPaused = d.status === "paused"
  const isRevoked = d.status === "revoked"

  const addedMs = Date.now() - new Date(d.created_at).getTime()
  const ageLabel = fmtRel(addedMs).replace(" ago", "")

  const server = serverQ.data
  const endpoint = server
    ? `${server.endpoint_host}:${server.endpoint_port}`
    : ""
  const serverDns = server ? server.dns_servers.join(", ") : ""

  // 30-day total — derived from the deviceBandwidth(30d) call, summed.
  // Pulled separately so the headline tile is honest about what window
  // it's showing.
  const totalBytes = (bwQ.data?.buckets ?? []).reduce(
    (s, b) => s + b.rx_bytes + b.tx_bytes,
    0,
  )

  const allowedIpsForDisplay =
    d.allowed_ips_override && d.allowed_ips_override.length > 0
      ? d.allowed_ips_override.join(", ")
      : "0.0.0.0/0, ::/0"
  const dnsForDisplay =
    d.dns_override && d.dns_override.length > 0
      ? d.dns_override.join(", ")
      : serverDns || "server default"

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow={`Devices · ${d.id.slice(0, 8).toUpperCase()}`}
        title={d.name}
        sub={`${d.os} · ${d.allocated_ip} · added ${ageLabel} ago`}
        right={
          <>
            <StatusPill
              status={
                isRevoked
                  ? "revoked"
                  : isPaused
                    ? "paused"
                    : isOnline
                      ? "online"
                      : "offline"
              }
            />
            {d.status === "active" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => pauseM.mutate()}
                disabled={pauseM.isPending}
              >
                <IconPlayerPause size={14} />
                Pause
              </Button>
            )}
            {d.status === "paused" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => unpauseM.mutate()}
                disabled={unpauseM.isPending}
              >
                <IconPlayerPlay size={14} />
                Resume
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadConfig(
                  d.name,
                  renderWgConf({ device: d, allowedIpsForDisplay, dnsForDisplay, endpoint }),
                )
              }
              disabled={isRevoked}
            >
              <IconDownload size={14} />
              Config
            </Button>
            {!isRevoked && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setRevokeOpen(true)}
              >
                <IconTrash size={14} />
                Revoke
              </Button>
            )}
          </>
        }
      />

      {/* KPI strip — design's 4-up: TX live, RX live, Total (window), Last handshake */}
      <KpiStrip>
        <Kpi
          label="TX · live"
          value={isOnline ? formatBps(live?.txBps ?? 0) : <Dash />}
          spark={isOnline ? txHistory.slice(-32) : []}
          sparkColor="var(--primary)"
          footL={isOnline ? "live" : "idle"}
          deltaTone={isOnline ? "up" : undefined}
        />
        <Kpi
          label="RX · live"
          value={isOnline ? formatBps(live?.rxBps ?? 0) : <Dash />}
          spark={isOnline ? rxHistory.slice(-32) : []}
          sparkColor="var(--chart-1)"
          footL={isOnline ? "live" : "idle"}
          deltaTone={isOnline ? "up" : undefined}
        />
        <Kpi
          label={`Total · ${range}`}
          value={
            bwQ.isLoading ? <Dash /> : <span className="tabular-nums">{formatBytes(totalBytes)}</span>
          }
          footL={`window ${range}`}
        />
        <Kpi
          label="Last handshake"
          value={<RelativeTime value={d.last_handshake_at} fallback="Never" />}
          footL={isOnline ? `stable · ${KEEPALIVE_SECS}s keepalive` : "—"}
        />
      </KpiStrip>

      {/* Row 1 (1.4fr × 1fr): Bandwidth | Configuration */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Bandwidth"
          sub={`device · ${range}`}
          right={
            <Seg
              value={range}
              options={["24h", "7d", "30d"] as const}
              onChange={setRange}
            />
          }
        >
          {bwQ.isLoading ? (
            <Skeleton className="h-[220px] rounded-none" />
          ) : bwQ.isError ? (
            <p className="text-destructive font-mono text-xs">
              Failed to load bandwidth.
            </p>
          ) : (
            <BandwidthChart buckets={bwQ.data?.buckets ?? []} height={220} />
          )}
        </Panel>

        <Panel
          title="Configuration"
          sub="WireGuard"
          right={
            isRevoked ? null : editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={saveConfigM.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveConfigM.mutate()}
                  disabled={saveConfigM.isPending}
                >
                  {saveConfigM.isPending ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
              >
                <IconPencil size={12} />
                Edit
              </Button>
            )
          }
        >
          {!editing ? (
            <ConfigReadOnly
              vpnIp={d.allocated_ip}
              publicKey={d.public_key}
              hub={endpoint || "—"}
              allowedIps={allowedIpsForDisplay}
              dns={dnsForDisplay}
              splitTunnel={tunnel === "split"}
            />
          ) : (
            <ConfigEditForm
              tunnel={tunnel}
              splitTunnelOn={splitTunnelOn}
              setSplitTunnelOn={(v) => {
                setSplitTunnelOn(v)
                setTunnel(v ? "split" : "full")
              }}
              splitCidrs={splitCidrs}
              setSplitCidrs={setSplitCidrs}
              customDns={customDns}
              setCustomDns={setCustomDns}
              serverDnsHint={serverDns}
            />
          )}
        </Panel>
      </div>

      {/* Row 2 (1.4fr × 1fr): wg-conf | QR / re-issue note */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="wg-conf"
          sub="hand-off · scan or copy"
          right={<LiveIndicator />}
        >
          <CopyableCode
            multiline
            value={renderWgConf({
              device: d,
              allowedIpsForDisplay,
              dnsForDisplay,
              endpoint,
            })}
          />
        </Panel>

        <Panel title="QR" sub="mobile / WireGuard app">
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-2 text-center">
            <div className="border-border bg-card text-muted-foreground flex size-[140px] items-center justify-center border font-mono text-[10px] leading-tight">
              QR not stored
              <br />
              after creation
            </div>
            <p className="text-muted-foreground font-mono text-[11px] leading-relaxed">
              The private key was handed off at device creation and is{" "}
              <span className="text-foreground">not stored</span> on the server.
              Re-scan from the saved .conf, or revoke + add a new device for a
              fresh keypair.
            </p>
          </div>
        </Panel>
      </div>

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Revoke device?"
        description="This removes the peer from WireGuard, frees its IP, and is irreversible. The user must add a new device to reconnect."
        confirmLabel="Revoke"
        destructive
        pending={deleteM.isPending}
        onConfirm={() => deleteM.mutate()}
      />
    </div>
  )
}

function ConfigReadOnly({
  vpnIp,
  publicKey,
  hub,
  allowedIps,
  dns,
  splitTunnel,
}: {
  vpnIp: string
  publicKey: string
  hub: string
  allowedIps: string
  dns: string
  splitTunnel: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <ConfigRow label="VPN IP" value={vpnIp} mono />
      <ConfigRow label="Public key" value={publicKey} mono truncate />
      <ConfigRow label="Hub" value={hub || "—"} mono />
      <ConfigRow label="Allowed IPs" value={allowedIps} mono />
      <ConfigRow label="DNS" value={dns} mono />
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="flex flex-col gap-1">
          <Eyebrow>Split tunnel</Eyebrow>
          <span className="text-foreground font-mono text-[13px]">
            {splitTunnel ? "On" : "Off"}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Eyebrow>Persistent keepalive</Eyebrow>
          <span className="text-foreground font-mono text-[13px]">
            {KEEPALIVE_SECS}s
          </span>
        </div>
      </div>
    </div>
  )
}

function ConfigRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string
  value: string
  mono?: boolean
  truncate?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <Eyebrow>{label}</Eyebrow>
      <div
        className={[
          "text-foreground text-[13px]",
          mono && "font-mono",
          truncate && "truncate",
        ]
          .filter(Boolean)
          .join(" ")}
        title={truncate ? value : undefined}
      >
        {value}
      </div>
    </div>
  )
}

function ConfigEditForm({
  tunnel,
  splitTunnelOn,
  setSplitTunnelOn,
  splitCidrs,
  setSplitCidrs,
  customDns,
  setCustomDns,
  serverDnsHint,
}: {
  tunnel: "full" | "split"
  splitTunnelOn: boolean
  setSplitTunnelOn: (v: boolean) => void
  splitCidrs: string
  setSplitCidrs: (v: string) => void
  customDns: string
  setCustomDns: (v: string) => void
  serverDnsHint: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="border-border flex items-center gap-3 border p-3">
        <Switch
          checked={splitTunnelOn}
          onCheckedChange={setSplitTunnelOn}
          id="dd-split-tunnel"
        />
        <Label
          htmlFor="dd-split-tunnel"
          className="flex flex-1 cursor-pointer flex-col gap-0.5"
        >
          <span className="text-sm font-medium">Split tunnel</span>
          <span className="text-muted-foreground font-mono text-[11px]">
            Only listed CIDRs route through the tunnel.
          </span>
        </Label>
      </div>

      {tunnel === "split" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dd-cidrs" className="zv-eyebrow">
            Allowed CIDRs
          </Label>
          <Input
            id="dd-cidrs"
            value={splitCidrs}
            onChange={(e) => setSplitCidrs(e.target.value)}
            placeholder="10.0.0.0/8, 192.168.0.0/16"
            className="font-mono"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dd-dns" className="zv-eyebrow">
          Custom DNS · optional
        </Label>
        <Input
          id="dd-dns"
          value={customDns}
          onChange={(e) => setCustomDns(e.target.value)}
          placeholder={serverDnsHint || "1.1.1.1, 1.0.0.1"}
          className="font-mono"
        />
        <p className="text-muted-foreground font-mono text-[11px]">
          Leave blank for server default
          {serverDnsHint ? ` (${serverDnsHint})` : ""}.
        </p>
      </div>
    </div>
  )
}

function Dash() {
  return <span className="text-muted-foreground/40">—</span>
}

/** Build a WireGuard config matching the design's wg-conf preview. The
 *  PrivateKey line is a placeholder because we don't persist private keys
 *  server-side — the real one was handed off at device creation. The
 *  server-side public key isn't currently exposed through /me/server
 *  either, so we show "(server public key)" until the API surfaces it. */
function renderWgConf({
  device,
  allowedIpsForDisplay,
  dnsForDisplay,
  endpoint,
}: {
  device: { allocated_ip: string }
  allowedIpsForDisplay: string
  dnsForDisplay: string
  endpoint: string
}) {
  return `[Interface]
PrivateKey = (held on device — not stored)
Address    = ${device.allocated_ip}/32
DNS        = ${dnsForDisplay}

[Peer]
PublicKey            = (server public key)
AllowedIPs           = ${allowedIpsForDisplay}
Endpoint             = ${endpoint || "(server endpoint)"}
PersistentKeepalive  = ${KEEPALIVE_SECS}`
}

function downloadConfig(name: string, config: string) {
  const safe = name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "zerovpn"
  const blob = new Blob([config], { type: "text/plain" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${safe}.conf`
  a.click()
  URL.revokeObjectURL(url)
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`
  return `${(n / 1024 ** 4).toFixed(2)} TB`
}

