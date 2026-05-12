import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconBrandAndroid,
  IconBrandApple,
  IconBrandWindows,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconDeviceMobile,
  IconDownload,
  IconFingerprint,
  IconGlobe,
  IconKey,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlugConnected,
  IconPlugConnectedX,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconSparkles,
  IconTerminal2,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useBreadcrumbOverride } from "@/hooks/useBreadcrumbOverride"
import { useHistoryHydration } from "@/hooks/useHistoryHydration"
import {
  ApiError,
  type BandwidthRange,
  type CreatedDevice,
  type DeviceEvent,
  type DeviceOs,
  deleteDevice,
  deviceBandwidth,
  getDevice,
  listDeviceEvents,
  meServer,
  patchDevice,
  pauseDevice,
  clearStoredDeviceKey,
  redownloadDeviceConf,
  rotateDeviceKeys,
  setDeviceDns,
  unpauseDevice,
} from "@/lib/api"
import { connState } from "@/lib/deviceState"
import { formatBps } from "@/lib/units"
import { cn } from "@/lib/utils"
import { useLiveStats } from "@/stores/liveStats"

const FULL_TUNNEL_PRESET = ["0.0.0.0/0", "::/0"]
const KEEPALIVE_SECS = 25

// Fixed suffix the server's DNS regex requires. Mirrors the
// `\.vpn\.local$` portion of `validate_hostname` in zerovpn-dns.
const DNS_SUFFIX = ".vpn.local"
// Same character class the server enforces — keep in sync with
// HOSTNAME_RE in crates/zerovpn-dns/src/lib.rs.
const DNS_PREFIX_RE = /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/

function isValidDnsPrefix(s: string): boolean {
  return DNS_PREFIX_RE.test(s.trim().toLowerCase())
}

function dnsPrefixError(s: string): string {
  const v = s.trim()
  if (!v) return "required"
  if (v.length > 30) return "too long (max 30 chars)"
  if (v !== v.toLowerCase()) return "lowercase only"
  if (/^-/.test(v)) return "can't start with a hyphen"
  if (/-$/.test(v)) return "can't end with a hyphen"
  if (/[^a-z0-9-]/i.test(v)) return "letters, digits and hyphens only"
  return "invalid hostname"
}

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

  // Activity timeline: lifecycle, config, DNS, key, and online/offline
  // transitions. Polled every 30s so a transition emitted by the worker
  // surfaces without a manual refresh.
  const eventsQ = useQuery({
    queryKey: ["device", id, "events"],
    queryFn: () => listDeviceEvents(id, 200),
    enabled: id.length > 0,
    refetchInterval: 30_000,
  })

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
  // Pause is reversible but still kicks the live tunnel for the user, so
  // we gate it (and unpause) behind explicit confirms — same pattern the
  // devices list uses.
  const [pauseOpen, setPauseOpen] = useState(false)
  const [unpauseOpen, setUnpauseOpen] = useState(false)
  // Peer-configuration dialog: per-OS install tabs + config + QR + re-issue.
  // Replaces the inline wg-conf + QR panels from the previous layout.
  const [configOpen, setConfigOpen] = useState(false)
  // Key rotation: confirm → mutate → show the rotated config + QR in a
  // dialog. The result holds the only copy of the fresh private key the
  // user will see; once they dismiss the dialog it's gone.
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false)
  const [rotated, setRotated] = useState<CreatedDevice | null>(null)
  // DNS hostname add dialog: text input for a new `<name>.vpn.local`-style
  // alias. Existing names are listed inline with per-row delete buttons.
  const [dnsAddOpen, setDnsAddOpen] = useState(false)
  const [dnsInput, setDnsInput] = useState("")
  // Server-stored-key toggles. Disabling = delete the encrypted column.
  // Enabling = piggy-back on the rotate flow with `store_private_key: true`
  // since the server needs a fresh key to encrypt (the original was never
  // saved on zero-knowledge devices).
  const [clearKeyOpen, setClearKeyOpen] = useState(false)
  const [enableKeyOpen, setEnableKeyOpen] = useState(false)

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
      setPauseOpen(false)
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
      setUnpauseOpen(false)
      void qc.invalidateQueries({ queryKey: ["device", id] })
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device active")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })
  // DNS hostnames are managed as a full-list replace under the hood; the
  // mutation accepts the next list and pushes it server-side. We do
  // optimistic toasts because the typical operation (add / remove one
  // entry) is small and the rollback case is just a query invalidate.
  const dnsM = useMutation({
    mutationFn: (names: string[]) => setDeviceDns(id, names),
    onSuccess: () => {
      setDnsAddOpen(false)
      setDnsInput("")
      void qc.invalidateQueries({ queryKey: ["device", id] })
      toast.success("DNS names updated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })
  const rotateM = useMutation({
    // The `vars` carry the storage opt-in: undefined → inherit current
    // setting; true/false → explicit override (used by the "Enable
    // server-stored key" action which always wants `true`).
    mutationFn: (opts: { store_private_key?: boolean } | undefined) =>
      rotateDeviceKeys(id, opts ?? {}),
    onSuccess: (data) => {
      setRotateConfirmOpen(false)
      setEnableKeyOpen(false)
      // Push the fresh config + QR into the same query cache the peer-
      // configuration dialog reads from, so the open dialog updates
      // instantly without needing a separate reveal modal.
      qc.setQueryData(["device", id, "conf"], data)
      void qc.invalidateQueries({ queryKey: ["device", id] })
      void qc.invalidateQueries({ queryKey: ["devices"] })
      // Only pop the standalone "rotated config" reveal when the user
      // triggered rotation from somewhere OTHER than the peer-config
      // dialog (e.g. via a future action). When the peer-config dialog
      // is the one open, the cache update above already does the job.
      if (!configOpen) {
        setRotated(data)
      }
      toast.success("Keys rotated — save the new config")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })
  const clearKeyM = useMutation({
    mutationFn: () => clearStoredDeviceKey(id),
    onSuccess: () => {
      setClearKeyOpen(false)
      // The stored-key cache is now stale (server returned no body).
      // Drop it so the peer-config dialog falls back to "no working
      // config" the next time it opens.
      qc.removeQueries({ queryKey: ["device", id, "conf"] })
      void qc.invalidateQueries({ queryKey: ["device", id] })
      toast.info("Server is no longer storing this device's key")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })
  // Re-download is now handled inside the PeerConfigDialog itself via a
  // `useQuery` that fires when the dialog opens — see PeerConfigDialog.
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
                onClick={() => setPauseOpen(true)}
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
                onClick={() => setUnpauseOpen(true)}
                disabled={unpauseM.isPending}
              >
                <IconPlayerPlay size={14} />
                Resume
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfigOpen(true)}
              disabled={isRevoked}
            >
              <IconSettings size={14} />
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
              privateKeyStored={d.private_key_stored}
              onClearStoredKey={() => setClearKeyOpen(true)}
              onEnableStoredKey={() => setEnableKeyOpen(true)}
              clearing={clearKeyM.isPending}
              isRevoked={isRevoked}
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

      {/* DNS names — separate panel so the host alias list is first-class
          (matches the reference VPN-FRONTEND project's DNS Management
          section). Replaces the inline "Custom DNS" affordance from the
          previous layout's edit form. */}
      <Panel
        title="DNS names"
        sub={
          <>
            Reach this peer from other peers via{" "}
            <span className="zv-kbd">name.vpn.local</span>.
          </>
        }
        right={
          isRevoked ? null : (
            <Button size="sm" onClick={() => setDnsAddOpen(true)}>
              <IconPlus size={12} />
              Add DNS name
            </Button>
          )
        }
      >
        {d.dns_names.length === 0 ? (
          <p className="text-muted-foreground/80 font-mono text-[11px]">
            No DNS names configured. Add one to give this device a stable
            hostname.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {d.dns_names.map((name) => (
              <DnsNameChip
                key={name}
                value={name}
                onRemove={() =>
                  dnsM.mutate(d.dns_names.filter((n) => n !== name))
                }
                pending={dnsM.isPending}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* Activity timeline — lifecycle, online/offline transitions, and
          every config / DNS / key change recorded against this device.
          Powered by the audit_logs table; updated lazily so an event the
          worker writes mid-session appears within ~30 s. */}
      <Panel
        title="Activity"
        sub="Lifecycle, connectivity and configuration changes"
        right={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => eventsQ.refetch()}
            disabled={eventsQ.isFetching}
            title="Refresh"
          >
            <IconRefresh
              size={12}
              className={eventsQ.isFetching ? "animate-spin" : undefined}
            />
            Refresh
          </Button>
        }
      >
        <DeviceTimeline
          events={eventsQ.data ?? []}
          loading={eventsQ.isLoading}
          error={eventsQ.error}
          onRetry={() => eventsQ.refetch()}
        />
      </Panel>

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

      <ConfirmDialog
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        title="Pause device?"
        description="The peer is removed from WireGuard until you resume it. The device's IP is held — no traffic is tunnelled while paused."
        confirmLabel="Pause"
        pending={pauseM.isPending}
        onConfirm={() => pauseM.mutate()}
      />

      <ConfirmDialog
        open={unpauseOpen}
        onOpenChange={setUnpauseOpen}
        title="Resume device?"
        description="The peer is re-added to WireGuard with its previously allocated IP. Traffic will start tunnelling as soon as the device handshakes."
        confirmLabel="Resume"
        pending={unpauseM.isPending}
        onConfirm={() => unpauseM.mutate()}
      />

      {/* Peer configuration dialog — per-OS install tabs with copy /
          download / re-issue affordances. Triggered by the page-head
          "Config" button. */}
      <PeerConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        deviceId={d.id}
        peerName={d.name}
        defaultOs={d.os}
        placeholderConfig={renderWgConf({
          device: d,
          allowedIpsForDisplay,
          dnsForDisplay,
          endpoint,
        })}
        privateKeyStored={d.private_key_stored}
        onReissue={() => {
          // Keep the peer-config dialog open behind the confirm — when
          // the user confirms, rotateM.onSuccess writes the fresh config
          // straight into the dialog's query cache so it updates in
          // place. The confirm dialog stacks on top via portal z-order.
          setRotateConfirmOpen(true)
        }}
        reissuing={rotateM.isPending}
      />

      {/* Add DNS name dialog — split input (prefix on the left, fixed
          .vpn.local suffix on the right) so the user types just the
          short name and we send the full FQDN to the API. The server
          regex requires the suffix verbatim. */}
      <Dialog open={dnsAddOpen} onOpenChange={setDnsAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add DNS name</DialogTitle>
            <DialogDescription>
              Give this device a hostname other peers can resolve. Type
              just the prefix — the{" "}
              <span className="zv-kbd">.vpn.local</span> suffix is fixed
              by the server.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dns-name" className="zv-eyebrow">
              Hostname
            </Label>
            <DnsHostnameInput
              value={dnsInput}
              onChange={setDnsInput}
              invalid={dnsInput.length > 0 && !isValidDnsPrefix(dnsInput)}
              onSubmit={() => {
                const prefix = dnsInput.trim().toLowerCase()
                if (!isValidDnsPrefix(prefix)) return
                const full = `${prefix}${DNS_SUFFIX}`
                if (d.dns_names.includes(full)) return
                dnsM.mutate([...d.dns_names, full])
              }}
            />
            <p className="text-muted-foreground font-mono text-[11px]">
              1–30 chars · lowercase letters, digits, hyphens · cannot
              start or end with a hyphen.
              {dnsInput.length > 0 && !isValidDnsPrefix(dnsInput) && (
                <span className="text-destructive ml-2">
                  {dnsPrefixError(dnsInput)}
                </span>
              )}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDnsAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const prefix = dnsInput.trim().toLowerCase()
                if (!isValidDnsPrefix(prefix)) return
                const full = `${prefix}${DNS_SUFFIX}`
                if (d.dns_names.includes(full)) {
                  toast.error("That hostname is already in the list")
                  return
                }
                dnsM.mutate([...d.dns_names, full])
              }}
              disabled={dnsM.isPending || !isValidDnsPrefix(dnsInput)}
            >
              {dnsM.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={rotateConfirmOpen}
        onOpenChange={setRotateConfirmOpen}
        title="Re-issue keys?"
        description="A fresh keypair is generated server-side. The current .conf on your device stops working immediately — you'll need to import the new one or re-scan the QR."
        confirmLabel="Re-issue"
        pending={rotateM.isPending}
        onConfirm={() => rotateM.mutate(undefined)}
      />

      <ConfirmDialog
        open={clearKeyOpen}
        onOpenChange={setClearKeyOpen}
        title="Stop storing the private key?"
        description="The server's KEK-encrypted copy is deleted. Your tunnel keeps working, but the .conf can't be re-downloaded later — only re-issued. Save your existing config now if you don't already have it."
        confirmLabel="Stop storing"
        destructive
        pending={clearKeyM.isPending}
        onConfirm={() => clearKeyM.mutate()}
      />

      <ConfirmDialog
        open={enableKeyOpen}
        onOpenChange={setEnableKeyOpen}
        title="Enable server-stored key?"
        description="To start storing the private key the server needs a fresh one — your current key was never saved (zero-knowledge default). Re-issuing rotates the keypair AND opts the new one into KEK-encrypted storage. The old .conf stops working immediately."
        confirmLabel="Re-issue & store"
        pending={rotateM.isPending}
        onConfirm={() => rotateM.mutate({ store_private_key: true })}
      />

      {/* Rotated-config reveal: shows the new QR + wg-conf in the same
          shape as the create-device dialog's step 2. The private key only
          exists in this payload — once the user dismisses, it's gone. */}
      <Dialog
        open={!!rotated}
        onOpenChange={(open) => {
          if (!open) setRotated(null)
        }}
      >
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>
              <Eyebrow>New config · save it now</Eyebrow>
            </DialogTitle>
            <DialogDescription>
              The fresh private key is in this config and{" "}
              <strong className="text-foreground">isn't stored</strong> after
              you dismiss this dialog.
            </DialogDescription>
          </DialogHeader>
          {rotated && (
            <div className="space-y-4">
              <div className="border-border grid gap-0 border md:grid-cols-[auto_1fr]">
                <div className="border-border bg-card flex aspect-square shrink-0 items-center justify-center md:aspect-auto md:w-[180px] md:border-r">
                  <span
                    className="block size-[148px] [&>svg]:size-full"
                    dangerouslySetInnerHTML={{ __html: rotated.qr_svg }}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-3 p-4">
                  <Eyebrow>Scan with WireGuard / mobile</Eyebrow>
                  <p className="text-muted-foreground font-mono text-[11px]">
                    Allocated IP{" "}
                    <span className="text-foreground">
                      {rotated.device.allocated_ip}
                    </span>
                  </p>
                  <div className="mt-auto grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        downloadConfig(rotated.device.name, rotated.config)
                      }
                    >
                      <IconDownload size={14} />
                      Download .conf
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(rotated.config)
                        toast.success("Config copied")
                      }}
                    >
                      Copy config
                    </Button>
                  </div>
                </div>
              </div>
              <div className="max-h-[260px] overflow-y-auto">
                <CopyableCode value={rotated.config} multiline />
              </div>
              <DialogFooter>
                <Button onClick={() => setRotated(null)}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
  privateKeyStored,
  onClearStoredKey,
  onEnableStoredKey,
  clearing,
  isRevoked,
}: {
  vpnIp: string
  publicKey: string
  hub: string
  allowedIps: string
  dns: string
  splitTunnel: boolean
  privateKeyStored: boolean
  onClearStoredKey: () => void
  onEnableStoredKey: () => void
  clearing: boolean
  isRevoked: boolean
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

      {/* Server-side private-key storage opt-in. Read-only state plus an
          action affordance — enabling requires a fresh keypair, so the
          "enable" path routes through the rotate flow. Disabling just
          drops the encrypted column. */}
      <div className="border-border bg-muted/20 flex items-center gap-3 border p-3">
        <div className="flex-1">
          <Eyebrow>Server-stored private key</Eyebrow>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span
              className={[
                "font-mono text-[13px] font-medium",
                privateKeyStored ? "text-status-online" : "text-muted-foreground",
              ].join(" ")}
            >
              {privateKeyStored ? "Enabled" : "Disabled"}
            </span>
            <span className="text-muted-foreground font-mono text-[10px]">
              {privateKeyStored
                ? "KEK-encrypted on the server · enables re-download"
                : "zero-knowledge · re-issue keys to enable"}
            </span>
          </div>
        </div>
        {!isRevoked &&
          (privateKeyStored ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClearStoredKey}
              disabled={clearing}
            >
              {clearing ? "Working…" : "Stop storing"}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onEnableStoredKey}>
              <IconRefresh size={12} />
              Enable
            </Button>
          ))}
      </div>
    </div>
  )
}

function ConfigRow({
  label,
  value,
  mono,
  truncate,
  copyable = true,
}: {
  label: string
  value: string
  mono?: boolean
  truncate?: boolean
  copyable?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <Eyebrow>{label}</Eyebrow>
      <div className="flex items-center gap-2">
        <div
          className={[
            "text-foreground min-w-0 flex-1 text-[13px]",
            mono && "font-mono",
            truncate && "truncate",
          ]
            .filter(Boolean)
            .join(" ")}
          title={truncate ? value : undefined}
        >
          {value}
        </div>
        {copyable && value && value !== "—" && (
          <CopyIcon value={value} />
        )}
      </div>
    </div>
  )
}

/** Tiny inline copy affordance: square hairline button that flips to a
 *  green check for ~1.2 s after copy. Used on every read-only config row
 *  so the user can grab any single value without clicking through to the
 *  full wg-conf dialog. */
function CopyIcon({ value, title }: { value: string; title?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          toast.error("Failed to copy")
        }
      }}
      title={title ?? "Copy"}
      className="text-muted-foreground hover:text-foreground border-border hover:border-foreground/40 flex size-6 shrink-0 items-center justify-center border transition-colors"
      aria-label={title ?? "Copy value"}
    >
      {copied ? (
        <IconCheck size={12} className="text-status-online" />
      ) : (
        <IconCopy size={12} />
      )}
    </button>
  )
}

/** Split hostname input: editable prefix on the left, fixed `.vpn.local`
 *  suffix on the right. The user only types the short name, but the full
 *  FQDN is what we ultimately submit (the server's regex requires it).
 *  Pressing Enter triggers `onSubmit` so the user can add without
 *  reaching for the mouse. */
function DnsHostnameInput({
  value,
  onChange,
  invalid,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  invalid: boolean
  onSubmit: () => void
}) {
  return (
    <div
      data-invalid={invalid ? "1" : undefined}
      className="border-input bg-transparent focus-within:border-ring focus-within:ring-ring/50 data-[invalid=1]:border-destructive data-[invalid=1]:ring-destructive/20 flex h-8 items-stretch overflow-hidden rounded-lg border transition-colors focus-within:ring-3 data-[invalid=1]:ring-3"
    >
      <input
        id="dns-name"
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder="laptop"
        autoFocus
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        maxLength={30}
        aria-invalid={invalid}
        className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent px-2.5 py-1 font-mono text-sm outline-none"
      />
      <span className="border-input bg-muted/40 text-muted-foreground inline-flex shrink-0 items-center border-l px-2.5 font-mono text-[12px]">
        {DNS_SUFFIX}
      </span>
    </div>
  )
}

/** Removable DNS hostname chip. Click delete to remove from the device's
 *  dns_names list. Mirrors the reference project's DNS row. */
function DnsNameChip({
  value,
  onRemove,
  pending,
}: {
  value: string
  onRemove: () => void
  pending: boolean
}) {
  return (
    <div className="border-border group flex items-center gap-2 border bg-card px-3 py-2">
      <IconGlobe size={14} className="text-muted-foreground shrink-0" />
      <span className="text-foreground min-w-0 flex-1 truncate font-mono text-[12px]">
        {value}
      </span>
      <CopyIcon value={value} />
      <button
        type="button"
        onClick={onRemove}
        disabled={pending}
        className="text-muted-foreground hover:text-destructive hover:border-destructive border-border flex size-6 shrink-0 items-center justify-center border transition-colors"
        aria-label={`Remove ${value}`}
        title="Remove"
      >
        <IconX size={12} />
      </button>
    </div>
  )
}

/** Per-action visual descriptor for the timeline. The tone tier maps to
 *  the StatusPill colour scheme so the activity feed reads at a glance
 *  ("green dot = went online", "red dot = revoked"). */
type EventTone = "online" | "offline" | "warn" | "info" | "neutral"

interface ActionSpec {
  label: string
  tone: EventTone
  icon: React.ComponentType<{ size?: number; className?: string }>
}

const ACTION_CATALOG: Record<string, ActionSpec> = {
  "device.created": {
    label: "Device created",
    tone: "info",
    icon: IconSparkles,
  },
  "device.online": {
    label: "Came online",
    tone: "online",
    icon: IconPlugConnected,
  },
  "device.offline": {
    label: "Went offline",
    tone: "offline",
    icon: IconPlugConnectedX,
  },
  "device.paused": {
    label: "Paused",
    tone: "warn",
    icon: IconPlayerPause,
  },
  "device.unpaused": {
    label: "Resumed",
    tone: "online",
    icon: IconPlayerPlay,
  },
  "device.revoked": {
    label: "Revoked",
    tone: "warn",
    icon: IconTrash,
  },
  "device.updated": {
    label: "Settings updated",
    tone: "info",
    icon: IconSettings,
  },
  "device.dns_updated": {
    label: "DNS names updated",
    tone: "info",
    icon: IconGlobe,
  },
  "device.keys_rotated": {
    label: "Keys rotated",
    tone: "info",
    icon: IconKey,
  },
  "device.conf_redownloaded": {
    label: "Config re-downloaded",
    tone: "neutral",
    icon: IconDownload,
  },
  "device.stored_key_cleared": {
    label: "Stored private key cleared",
    tone: "warn",
    icon: IconKey,
  },
  "device.reordered": {
    label: "Re-ordered in list",
    tone: "neutral",
    icon: IconSettings,
  },
}

function actionSpec(action: string): ActionSpec {
  return (
    ACTION_CATALOG[action] ?? {
      label: action,
      tone: "neutral",
      icon: IconFingerprint,
    }
  )
}

const TONE_DOT: Record<EventTone, string> = {
  online: "bg-status-online",
  offline: "bg-foreground/40",
  warn: "bg-status-degraded",
  info: "bg-primary",
  neutral: "bg-muted-foreground",
}
const TONE_RING: Record<EventTone, string> = {
  online: "ring-status-online/30",
  offline: "ring-foreground/20",
  warn: "ring-status-degraded/30",
  info: "ring-primary/30",
  neutral: "ring-muted-foreground/30",
}
const TONE_ICON: Record<EventTone, string> = {
  online: "text-status-online",
  offline: "text-muted-foreground",
  warn: "text-status-degraded",
  info: "text-primary",
  neutral: "text-muted-foreground",
}

/** Vertical timeline of device events. Renders newest-first with a left
 *  rail and an icon-on-dot per row. Each row's right-hand block shows
 *  the action label, a relative timestamp ("3 min ago") that lives-
 *  updates via <RelativeTime>, and — for online/offline transitions —
 *  a small "after Xh of being online/offline" duration computed from
 *  the previous adjacent transition. Metadata (when present) is
 *  inline-collapsible so users can dig into config diffs without
 *  drowning the feed. */
function DeviceTimeline({
  events,
  loading,
  error,
  onRetry,
}: {
  events: DeviceEvent[]
  loading: boolean
  error: unknown
  onRetry?: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 rounded-none" />
        ))}
      </div>
    )
  }
  if (error) {
    // Surface the real reason from ApiError when we have it (status +
    // message). Without this the user just sees "Failed to load" and
    // has to dig into devtools — pointless friction when the message
    // usually tells you exactly what's wrong (404 means the API binary
    // doesn't have the /events route yet, 500 means a query failure,
    // 401 means session expired, etc.).
    const e = error as { status?: number; message?: string } | null
    const status = e?.status
    const message = e?.message ?? "Failed to load activity."
    return (
      <div className="flex flex-col gap-2 font-mono text-[12px]">
        <p className="text-destructive">
          {status ? `${status} · ${message}` : message}
        </p>
        {status === 404 && (
          <p className="text-muted-foreground/80 text-[11px]">
            The /devices/{`{id}`}/events endpoint isn't available on
            this API build — rebuild and restart the api binary
            (cargo run -p zerovpn-api) to pick it up.
          </p>
        )}
        {onRetry && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry}
            className="self-start"
          >
            <IconRefresh size={12} />
            Retry
          </Button>
        )}
      </div>
    )
  }
  if (events.length === 0) {
    return (
      <p className="text-muted-foreground/80 font-mono text-[11px]">
        No activity recorded yet. Events will appear here as the device
        is used and updated.
      </p>
    )
  }

  // Precompute durations between adjacent online/offline transitions so
  // each row can show "after Nh of being online" / "after Nh of being
  // offline". Walk newest-first but the duration belongs to the SHORTER
  // interval ending at the current row — i.e. the time since the
  // previous-state-defining transition immediately above it (which is
  // the next index in the desc-sorted list).
  const durations = computeTransitionDurations(events)

  // Group consecutive same-day events for the date heading rail. Just
  // a flat list — we render the date label above the first event of a
  // new YYYY-MM-DD.
  let lastDay: string | null = null

  return (
    <ol className="relative flex flex-col">
      {/* The vertical rail spans the full timeline. Each row positions
          its dot precisely on top so the line passes through. */}
      <span
        aria-hidden
        className="border-border absolute bottom-2 left-3 top-2 border-l"
      />
      {events.map((ev, i) => {
        const spec = actionSpec(ev.action)
        const Icon = spec.icon
        const day = ev.created_at.slice(0, 10)
        const showDay = day !== lastDay
        lastDay = day
        const dur = durations[i]
        return (
          <li key={ev.id} className="flex flex-col">
            {showDay && (
              <div className="ml-9 mb-1 mt-3 first:mt-0">
                <span className="text-muted-foreground/70 font-mono text-[10px] uppercase tracking-[0.08em]">
                  {formatDayLabel(day)}
                </span>
              </div>
            )}
            <div className="relative flex items-start gap-3 py-1.5">
              <span
                className={cn(
                  "relative mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full ring-4",
                  TONE_RING[spec.tone],
                  "bg-background",
                )}
              >
                <span
                  className={cn(
                    "absolute inset-1 rounded-full",
                    TONE_DOT[spec.tone],
                    "opacity-15",
                  )}
                />
                <Icon
                  size={12}
                  className={cn("relative", TONE_ICON[spec.tone])}
                />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-foreground text-[13px] font-medium">
                    {spec.label}
                  </span>
                  <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                    <RelativeTime value={ev.created_at} />
                  </span>
                </div>
                <div className="text-muted-foreground/80 flex flex-wrap items-center gap-x-2 font-mono text-[11px]">
                  {dur && (
                    <span>
                      after {formatDuration(dur.seconds)} {dur.state}
                    </span>
                  )}
                  <EventMetadata action={ev.action} metadata={ev.metadata} />
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Renders the non-trivial parts of an event's metadata blob. Only
 *  certain actions carry information worth surfacing inline — for the
 *  rest we render nothing rather than dumping raw JSON. */
function EventMetadata({
  action,
  metadata,
}: {
  action: string
  metadata: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  if (action === "device.dns_updated") {
    const names = Array.isArray(metadata.dns_names)
      ? (metadata.dns_names as string[])
      : []
    if (names.length === 0) return <span>(cleared)</span>
    return (
      <span className="truncate">
        {names.slice(0, 3).join(", ")}
        {names.length > 3 && ` +${names.length - 3}`}
      </span>
    )
  }
  if (action === "device.paused" || action === "device.unpaused") {
    const to = metadata.to
    if (typeof to === "string") return <span>now {to}</span>
    return null
  }
  if (action === "device.created") {
    const split = metadata.split_tunnel === true
    const stored = metadata.private_key_stored === true
    const parts: string[] = []
    if (split) parts.push("split tunnel")
    if (stored) parts.push("key stored")
    if (parts.length === 0) return null
    return <span>{parts.join(" · ")}</span>
  }
  if (action === "device.updated") {
    // Free-form patch payload — collapse to a "details" toggle so the
    // row stays scannable but full data is one click away.
    const hasContent = Object.keys(metadata).length > 0
    if (!hasContent) return null
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          {open ? (
            <IconChevronUp size={11} />
          ) : (
            <IconChevronDown size={11} />
          )}
          details
        </button>
        {open && (
          <pre className="border-border bg-muted/30 mt-1 max-h-40 w-full overflow-auto whitespace-pre-wrap border p-2 font-mono text-[10px] leading-relaxed">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        )}
      </>
    )
  }
  return null
}

/** For each event (in the desc-sorted timeline), compute the duration
 *  the device was in its previous state if and only if both adjacent
 *  events are online/offline transitions. Returns `{ seconds, state }`
 *  where `state` is the value of the *previous* state — i.e. how long
 *  the device was online before going offline, or vice versa. */
function computeTransitionDurations(
  events: DeviceEvent[],
): ({ seconds: number; state: "online" | "offline" } | null)[] {
  const out: ({ seconds: number; state: "online" | "offline" } | null)[] = []
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    // The "previous" transition in chronological order is the next
    // entry in the desc-sorted list.
    const prev = events[i + 1]
    if (!prev) {
      out.push(null)
      continue
    }
    const isTransition = (a: string) =>
      a === "device.online" || a === "device.offline"
    if (!isTransition(ev.action) || !isTransition(prev.action)) {
      out.push(null)
      continue
    }
    const seconds =
      (new Date(ev.created_at).getTime() -
        new Date(prev.created_at).getTime()) /
      1000
    if (!Number.isFinite(seconds) || seconds <= 0) {
      out.push(null)
      continue
    }
    // State during the gap = the state RECORDED by `prev`. If prev was
    // "device.online" it means the device became online at prev's time
    // and stayed there until going offline at ev's time.
    const state: "online" | "offline" =
      prev.action === "device.online" ? "online" : "offline"
    out.push({ seconds, state })
  }
  return out
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const remM = m % 60
  if (h < 24) return remM > 0 ? `${h}h ${remM}m` : `${h}h`
  const d = Math.floor(h / 24)
  const remH = h % 24
  return remH > 0 ? `${d}d ${remH}h` : `${d}d`
}

function formatDayLabel(day: string): string {
  // `day` is YYYY-MM-DD. Compare against today / yesterday so the rail
  // shows friendly day chips rather than raw dates at the top.
  const today = new Date()
  const yToday = today.toISOString().slice(0, 10)
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  if (day === yToday) return "Today"
  if (day === yesterday) return "Yesterday"
  return day
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
/** Peer-configuration dialog. Mirrors the layout from
 *  VPN-FRONTEND/PeerDetails — per-OS tabs (Linux / Windows / macOS /
 *  Android / iOS) with install hints, the rendered wg-conf in a copyable
 *  multiline block, and actions (Download / Copy / Re-issue keys, plus
 *  Re-download when the server still has the private key encrypted). */
function PeerConfigDialog({
  open,
  onOpenChange,
  deviceId,
  peerName,
  defaultOs,
  placeholderConfig,
  privateKeyStored,
  onReissue,
  reissuing,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  deviceId: string
  peerName: string
  defaultOs: DeviceOs
  /** Rendered wg-conf that uses the `(held on device — not stored)`
   *  placeholder for the private key. Shown when the server doesn't have
   *  an encrypted copy, so the file is still scannable for the user to
   *  splice their own key in. */
  placeholderConfig: string
  privateKeyStored: boolean
  onReissue: () => void
  reissuing: boolean
}) {
  const initialTab = osToTab(defaultOs)

  // When the server holds an encrypted copy of the private key, fetch
  // the real .conf (+ QR) so we can show the working file and a scannable
  // QR. We gate on `open` so the dialog doesn't trigger fetches the
  // moment the page loads. Cached short-lived — the underlying key
  // doesn't change unless the user re-issues, and rotation invalidates
  // the ["device", id] query which also bumps `privateKeyStored`.
  const confQ = useQuery({
    queryKey: ["device", deviceId, "conf"],
    queryFn: () => redownloadDeviceConf(deviceId),
    enabled: open && privateKeyStored,
    staleTime: 60_000,
  })

  // Effective config text + QR: real one when available. When the
  // server doesn't hold the key AND nothing has been rotated into the
  // cache yet, we have no working config to show — the dialog collapses
  // to a "re-issue to get one" call-to-action.
  const realConfig = confQ.data?.config
  const realQrSvg = confQ.data?.qr_svg
  const loadingReal = privateKeyStored && confQ.isLoading
  // The placeholder is only useful as something to download when we
  // actually have a real config; otherwise it'd just be a broken file.
  const effectiveConfig = realConfig ?? placeholderConfig
  // Has-working-config: gates the tabs + Download button. Once a
  // rotation lands its result in the cache (or the server-stored
  // private key gets fetched), this flips to true and the tabs show.
  const hasWorkingConfig = !!realConfig

  const downloadNow = () => downloadConfig(peerName, effectiveConfig)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>
            <Eyebrow>
              Peer configuration · <span className="text-foreground">{peerName}</span>
            </Eyebrow>
          </DialogTitle>
          <DialogDescription>
            Per-OS install steps below. The same wg-conf works for every
            platform — pick whichever has the smoothest hand-off for the
            device you're setting up.
          </DialogDescription>
        </DialogHeader>

        {/* Banner — explicit about what config the user is seeing.
            Stored-key + loading: muted "loading" pill.
            Stored-key + error: destructive pill, re-issue offered.
            No stored key AND nothing rotated in yet: full call-to-action;
            the tabs + download below are hidden so the dialog reads as a
            single "re-issue to get a working config" prompt instead of
            offering a placeholder file that wouldn't actually connect. */}
        {hasWorkingConfig ? null : loadingReal ? (
          <div className="border-border bg-muted/40 text-muted-foreground border px-3 py-2 font-mono text-[11px]">
            Loading server-stored config…
          </div>
        ) : privateKeyStored && confQ.isError ? (
          <div className="border-destructive/40 bg-destructive/5 text-destructive border px-3 py-2 font-mono text-[11px]">
            Couldn't fetch the stored config. Re-issue keys for a fresh
            one.
          </div>
        ) : (
          <div className="border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed">
            <span className="text-foreground font-medium">
              Private key isn't stored server-side.
            </span>{" "}
            We can't show you a working configuration — click{" "}
            <strong className="text-foreground">Re-issue keys</strong> to
            generate a fresh keypair you can save. The old config will
            stop working immediately.
          </div>
        )}

        {hasWorkingConfig && (
        <Tabs defaultValue={initialTab}>
          <TabsList className="grid grid-cols-5">
            <TabsTrigger value="linux">
              <IconTerminal2 size={14} className="mr-1.5" />
              Linux
            </TabsTrigger>
            <TabsTrigger value="windows">
              <IconBrandWindows size={14} className="mr-1.5" />
              Win
            </TabsTrigger>
            <TabsTrigger value="macos">
              <IconBrandApple size={14} className="mr-1.5" />
              macOS
            </TabsTrigger>
            <TabsTrigger value="android">
              <IconBrandAndroid size={14} className="mr-1.5" />
              Android
            </TabsTrigger>
            <TabsTrigger value="ios">
              <IconDeviceMobile size={14} className="mr-1.5" />
              iOS
            </TabsTrigger>
          </TabsList>

          <TabsContent value="linux" className="mt-3 space-y-3">
            <Step
              n={1}
              text="Create the configuration file"
              command={`sudo touch /etc/wireguard/${peerName}.conf`}
            />
            <Step
              n={2}
              text="Open the file and paste the config below"
              command={`sudo nano /etc/wireguard/${peerName}.conf`}
            />
            <ConfigBlock value={effectiveConfig} />
            <Step n={3} text="Bring the tunnel up" command={`sudo wg-quick up ${peerName}`} />
            <Step
              n={4}
              text="Enable on boot (optional)"
              command={`sudo systemctl enable wg-quick@${peerName}`}
            />
          </TabsContent>

          <TabsContent value="windows" className="mt-3 space-y-3">
            <Step n={1} text={`Save the config below as ${peerName}.conf`} />
            <ConfigBlock value={effectiveConfig} />
            <p className="text-muted-foreground font-mono text-[11px] leading-relaxed">
              Step 2: open the WireGuard application → "Import tunnel(s)
              from file" → select <strong>{peerName}.conf</strong>.
            </p>
          </TabsContent>

          <TabsContent value="macos" className="mt-3 space-y-3">
            <p className="text-muted-foreground font-mono text-[11px] leading-relaxed">
              For the GUI app from the App Store, save the config and use
              "Import tunnel(s) from file". For the CLI (Homebrew
              wireguard-tools):
            </p>
            <Step
              n={1}
              text="Create the file"
              command={`touch /etc/wireguard/${peerName}.conf`}
            />
            <Step
              n={2}
              text="Paste the config and bring it up"
              command={`sudo wg-quick up ${peerName}`}
            />
            <ConfigBlock value={effectiveConfig} />
          </TabsContent>

          <TabsContent value="android" className="mt-3 space-y-3">
            <MobileQrSlot
              qrSvg={realQrSvg}
              loading={loadingReal}
              privateKeyStored={privateKeyStored}
              onReissue={onReissue}
            />
            <p className="text-muted-foreground font-mono text-[11px] leading-relaxed">
              Install the WireGuard app, tap the <strong>+</strong> button
              → "Scan from QR code" and point it at the QR above. Or use
              "Create from file or archive" with the .conf below.
            </p>
            <ConfigBlock value={effectiveConfig} />
          </TabsContent>

          <TabsContent value="ios" className="mt-3 space-y-3">
            <MobileQrSlot
              qrSvg={realQrSvg}
              loading={loadingReal}
              privateKeyStored={privateKeyStored}
              onReissue={onReissue}
            />
            <p className="text-muted-foreground font-mono text-[11px] leading-relaxed">
              Install the WireGuard app from the App Store, tap{" "}
              <strong>+</strong> → "Create from QR code" and point the
              camera at the QR above.
            </p>
            <ConfigBlock value={effectiveConfig} />
          </TabsContent>
        </Tabs>
        )}

        <DialogFooter className="mt-3 flex-wrap gap-2">
          {/* Download is only meaningful once we have a real config —
              without a valid private key the .conf wouldn't connect. */}
          {hasWorkingConfig && (
            <Button
              size="sm"
              variant="ghost"
              onClick={downloadNow}
              disabled={loadingReal}
            >
              <IconDownload size={14} />
              Download .conf
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onReissue}
            disabled={reissuing}
          >
            <IconRefresh size={14} />
            {reissuing ? "Rotating…" : "Re-issue keys"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Step({
  n,
  text,
  command,
}: {
  n: number
  text: string
  command?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="bg-muted text-foreground border-border flex size-5 shrink-0 items-center justify-center border font-mono text-[11px]">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-foreground/90 text-[13px] leading-snug">{text}</p>
        {command && (
          <div className="border-border bg-muted/40 flex items-center justify-between gap-2 border px-2 py-1.5">
            <code className="text-foreground/90 break-all font-mono text-[11px]">
              {command}
            </code>
            <CopyIcon value={command} />
          </div>
        )}
      </div>
    </div>
  )
}

function ConfigBlock({ value }: { value: string }) {
  return (
    <div className="max-h-[260px] overflow-y-auto">
      <CopyableCode value={value} multiline />
    </div>
  )
}

/** Mobile-tab QR slot. Shows the real server-rendered QR when the
 *  private key is stored, a loading placeholder while fetching, or a
 *  "no QR until you re-issue" call-to-action otherwise. Tightly scoped
 *  for Android / iOS tabs — desktop platforms get the .conf file alone
 *  since scanning a QR isn't the typical hand-off there. */
function MobileQrSlot({
  qrSvg,
  loading,
  privateKeyStored,
  onReissue,
}: {
  qrSvg: string | undefined
  loading: boolean
  privateKeyStored: boolean
  onReissue: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="border-border bg-card text-muted-foreground flex size-[180px] items-center justify-center border p-2 text-center font-mono text-[10px] leading-tight">
        {loading ? (
          <span>loading QR…</span>
        ) : qrSvg ? (
          <span
            className="block size-full [&>svg]:size-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : privateKeyStored ? (
          <span>QR unavailable — try again</span>
        ) : (
          <span>
            No QR stored.
            <br />
            Re-issue to get one.
          </span>
        )}
      </div>
      {!privateKeyStored && !qrSvg && (
        <Button size="sm" variant="outline" onClick={onReissue}>
          <IconRefresh size={14} />
          Re-issue keys
        </Button>
      )}
    </div>
  )
}

/** Pick the dialog's initial tab from the device's recorded OS so the
 *  user lands on instructions for the platform they actually have. */
function osToTab(os: DeviceOs): string {
  switch (os) {
    case "ios":
      return "ios"
    case "android":
      return "android"
    case "macos":
      return "macos"
    case "windows":
      return "windows"
    case "linux":
      return "linux"
    default:
      return "linux"
  }
}

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

