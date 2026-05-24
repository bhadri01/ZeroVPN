import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconDeviceTablet, IconDownload, IconPlus, IconQrcode } from "@tabler/icons-react"
import { AnimatePresence, motion } from "motion/react"
import { useMemo, useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { LiveIndicator } from "@/components/charts/LazyNetworkMonitorChart"
import { CandleChart } from "@/components/charts/CandleChart"
import { CopyableCode } from "@/components/CopyableCode"
import { LiveEventStream } from "@/components/dashboard/LiveEventStream"
import { RecentActivity } from "@/components/dashboard/RecentActivity"
import { EmptyState } from "@/components/EmptyState"
import { PageStagger, StaggerItem } from "@/components/motion"
import { Kpi, KpiStrip, PageHead, Panel } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ApiError,
  type CreatedDevice,
  type DeviceOs,
  adminListServers,
  createDevice,
  listDevices,
  myUsage,
} from "@/lib/api"
import { copyText } from "@/lib/clipboard"
import { formatDate } from "@/lib/datetime"
import { connState } from "@/lib/deviceState"
import { formatBytes } from "@/lib/units"
import { useHistoryHydration } from "@/hooks/useHistoryHydration"
import { useAuth } from "@/stores/auth"
import { useLiveStats } from "@/stores/liveStats"

export function DashboardPage() {
  const queryClient = useQueryClient()
  const user = useAuth((s) => s.user)
  const isAdmin = user?.role === "admin"

  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
  // Hydrate the rolling per-device live history from the server-side
  // tick-level samples so the chart isn't empty after a refresh. The hook
  // fires WS-aware merges so any live deltas that landed before the
  // fetch completed aren't lost.
  const deviceIds = useMemo(
    () =>
      (devicesQ.data ?? [])
        .filter((d) => d.status === "active" || d.status === "paused")
        .map((d) => d.id),
    [devicesQ.data],
  )
  useHistoryHydration({ deviceIds, windowSec: 300 })
  const [created, setCreated] = useState<CreatedDevice | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState("")
  const [osChoice, setOsChoice] = useState<DeviceOs>("other")

  const liveDevices = useLiveStats((s) => s.devices)
  const rates = useMemo(() => {
    const m = new Map<string, { rxBps: number; txBps: number }>()
    for (const [id, d] of Object.entries(liveDevices)) {
      m.set(id, { rxBps: d.rxBps, txBps: d.txBps })
    }
    return m
  }, [liveDevices])

  // Hubs KPI — admin-only; the public API doesn't expose server topology to
  // regular users. For non-admins we render a paused-devices KPI instead so
  // the strip stays 4-up without inventing data.
  const serversQ = useQuery({
    queryKey: ["admin", "servers", "dashboard"],
    queryFn: adminListServers,
    enabled: isAdmin,
    refetchInterval: 30_000,
  })

  // Account-level monthly quota for the "Quota" KPI card.
  const usageQ = useQuery({
    queryKey: ["me", "usage"],
    queryFn: myUsage,
    refetchInterval: 60_000,
  })

  const addM = useMutation({
    mutationFn: () => createDevice({ name: name.trim(), os: osChoice }),
    onSuccess: (data) => {
      setCreated(data)
      setName("")
      setAddOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device added")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  // Stable reference so the totals/online memos below don't recompute on
  // every render just because `?? []` minted a fresh array.
  const devices = useMemo(() => devicesQ.data ?? [], [devicesQ.data])
  const active = devices.filter((d) => d.status === "active").length
  const paused = devices.filter((d) => d.status === "paused").length

  // Headline totals = the sum of every device's lifetime RX/TX — the exact
  // figure each device card shows — grown live by the WS store so the numbers
  // tick up in real time. Summing the persisted per-device lifetime totals
  // (not a 30-day aggregate window) keeps the dashboard consistent with the
  // device cards + detail pages. See useLiveTotal / device_totals.
  const totalRxBytes = useMemo(
    () =>
      devices.reduce(
        (s, d) =>
          s + Math.max(d.total_rx_bytes, liveDevices[d.id]?.lifeRxBytes ?? 0),
        0,
      ),
    [devices, liveDevices],
  )
  const totalTxBytes = useMemo(
    () =>
      devices.reduce(
        (s, d) =>
          s + Math.max(d.total_tx_bytes, liveDevices[d.id]?.lifeTxBytes ?? 0),
        0,
      ),
    [devices, liveDevices],
  )
  const totalUsageBytes = totalRxBytes + totalTxBytes

  // Account monthly quota for the "Quota" card. `cap == null` ⇒ unlimited.
  const quotaCap = usageQ.data?.monthly_byte_cap ?? null
  const quotaUsed = usageQ.data?.current_month_bytes ?? 0
  const quotaPct =
    quotaCap && quotaCap > 0
      ? Math.min(100, Math.round((quotaUsed / quotaCap) * 100))
      : null
  const quotaResetsAt = usageQ.data?.quota_resets_at

  // Only currently-online devices contribute to "live" numbers. A device
  // that's offline / paused / revoked cannot be transmitting RIGHT NOW,
  // so any rate the WS store still holds for it is stale and dropped.
  const onlineDeviceIds = useMemo(
    () => devices.filter((d) => connState(d) === "online").map((d) => d.id),
    [devices],
  )
  const onlineCount = onlineDeviceIds.length
  const totalRx = useMemo(() => {
    let s = 0
    for (const id of onlineDeviceIds) s += rates.get(id)?.rxBps ?? 0
    return s
  }, [onlineDeviceIds, rates])
  const totalTx = useMemo(() => {
    let s = 0
    for (const id of onlineDeviceIds) s += rates.get(id)?.txBps ?? 0
    return s
  }, [onlineDeviceIds, rates])

  // Sparkline history for the KPI + the side panel monitor: sum per-device
  // histories only for currently-online devices, right-aligned so a
  // device that just connected doesn't backfill zeros into the past.
  const liveHistory = useMemo(() => {
    const ids = onlineDeviceIds
    if (ids.length === 0)
      return { rx: [] as number[], tx: [] as number[], total: [] as number[] }
    let maxLen = 0
    const rxSlices: number[][] = []
    const txSlices: number[][] = []
    const window = 32
    for (const id of ids) {
      const d = liveDevices[id]
      if (!d) continue
      const rx = d.rxHistory.slice(-window)
      const tx = d.txHistory.slice(-window)
      if (rx.length === 0 && tx.length === 0) continue
      rxSlices.push(rx)
      txSlices.push(tx)
      maxLen = Math.max(maxLen, rx.length, tx.length)
    }
    if (maxLen === 0) return { rx: [], tx: [], total: [] }
    const rx = new Array<number>(maxLen).fill(0)
    const tx = new Array<number>(maxLen).fill(0)
    for (const s of rxSlices) {
      const off = maxLen - s.length
      for (let i = 0; i < s.length; i++) rx[off + i] += s[i]
    }
    for (const s of txSlices) {
      const off = maxLen - s.length
      for (let i = 0; i < s.length; i++) tx[off + i] += s[i]
    }
    // Combined per-second total (rx+tx) — the "Total usage" card's line.
    const total = rx.map((v, i) => v + tx[i])
    return { rx, tx, total }
  }, [onlineDeviceIds, liveDevices])

  const servers = serversQ.data ?? []
  const liveHubs = servers.filter((s) => s.is_active).length

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead eyebrow="Workspace · 01" title="Dashboard" />
      </StaggerItem>

      {/* Add-device dialog. The header trigger button is intentionally gone;
          the empty-state CTA below calls `setAddOpen(true)` when the user
          has no devices yet. Once they have at least one, this dialog is
          only reachable via /app/devices. */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add device</DialogTitle>
            <DialogDescription>
              We generate a fresh keypair, allocate an IP, and hand you a
              WireGuard config. The private key never leaves the page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dev-name" className="zv-eyebrow">
                Name
              </Label>
              <Input
                id="dev-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Pixel 8, MacBook Pro…"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="zv-eyebrow">Operating system</Label>
              <Select
                value={osChoice}
                onValueChange={(v) => setOsChoice(v as DeviceOs)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["ios", "android", "macos", "windows", "linux", "other"] as DeviceOs[]).map(
                    (o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => addM.mutate()}
              disabled={addM.isPending || name.trim().length === 0}
            >
              {addM.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* KPI strip — 4-up. Devices online · Usage (range) · TX · RX.
          Headline numbers are window-scoped totals from the user's
          bandwidth rollups so the dashboard reflects the same activity
          the chart below renders; the live bps rate sits in the footer
          so "right now" is still readable at a glance. */}
      <StaggerItem>
        <KpiStrip cols={5}>
        <Kpi
          label="Devices · online"
          value={onlineCount}
          unit={devices.length > 0 ? `/ ${devices.length}` : undefined}
          footL={
            paused > 0
              ? `${active} active · ${paused} paused`
              : onlineCount === 0 && active > 0
                ? `${active} active · awaiting handshake`
                : `${active} active`
          }
          footR={devicesQ.dataUpdatedAt ? "updated now" : ""}
          deltaTone={onlineCount > 0 ? "up" : undefined}
        />
        <Kpi
          label="Total RX"
          value={devicesQ.isLoading ? "—" : formatBytes(totalRxBytes)}
          spark={liveHistory.rx}
          sparkColor="var(--chart-1)"
          footL={
            onlineCount === 0
              ? "no online devices"
              : `live · ${formatRate(totalRx)}`
          }
        />
        <Kpi
          label="Total TX"
          value={devicesQ.isLoading ? "—" : formatBytes(totalTxBytes)}
          spark={liveHistory.tx}
          sparkColor="var(--primary)"
          footL={
            onlineCount === 0
              ? "no online devices"
              : `live · ${formatRate(totalTx)}`
          }
        />
        <Kpi
          label="Total usage"
          value={devicesQ.isLoading ? "—" : formatBytes(totalUsageBytes)}
          spark={liveHistory.total}
          sparkColor="var(--primary)"
          footL={`RX ${formatBytes(totalRxBytes)} · TX ${formatBytes(totalTxBytes)}`}
          footR={isAdmin && servers.length > 0 ? `${liveHubs}/${servers.length} hubs` : undefined}
        />
        <Kpi
          label="Quota"
          value={
            usageQ.isLoading
              ? "—"
              : quotaPct == null
                ? "Unlimited"
                : `${quotaPct}%`
          }
          footL={
            quotaPct == null
              ? `${formatBytes(quotaUsed)} this month`
              : `${formatBytes(quotaUsed)} / ${formatBytes(quotaCap ?? 0)}`
          }
          footR={quotaResetsAt ? `resets ${formatDate(quotaResetsAt)}` : undefined}
        />
        </KpiStrip>
      </StaggerItem>

      <AnimatePresence>
        {created && (
          <CreatedDeviceCard data={created} onClose={() => setCreated(null)} />
        )}
      </AnimatePresence>

      {/* Row 2: bandwidth — OHLC candle chart aggregated across all the user's
          devices. Owns its own timeframe + zoom/pan controls (same chart as
          the device detail + admin overview pages). */}
      <StaggerItem>
        <Panel title="Bandwidth" sub="All devices · scroll to zoom · drag to pan">
          <CandleChart scope="user" height={260} />
        </Panel>
      </StaggerItem>

      {/* First-device empty state — surfaced only when there are zero
          devices, since the devices table is no longer on this page. */}
      {devicesQ.data && devicesQ.data.length === 0 && (
        <StaggerItem>
          <Panel>
            <EmptyState
              icon={IconDeviceTablet}
              title="No devices yet"
              description="Add your first device to receive a WireGuard config."
              action={
                <Button onClick={() => setAddOpen(true)}>
                  <IconPlus />
                  Add device
                </Button>
              }
            />
          </Panel>
        </StaggerItem>
      )}

      {/* Row 4: recent activity (left) + live event stream (right) */}
      <StaggerItem className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Recent activity"
          sub={isAdmin ? "audit · last 8" : "live events · last 8"}
          flush
          right={
            isAdmin ? (
              <Link
                to="/admin/audit"
                className="text-muted-foreground hover:text-foreground font-mono text-xs"
              >
                View all ↗
              </Link>
            ) : null
          }
        >
          <RecentActivity limit={8} />
        </Panel>

        <Panel
          title="Live event stream"
          sub="ws · /api/v1/ws"
          right={<LiveIndicator />}
          flush
        >
          <LiveEventStream />
        </Panel>
      </StaggerItem>
    </PageStagger>
  )
}

function CreatedDeviceCard({
  data,
  onClose,
}: {
  data: CreatedDevice
  onClose: () => void
}) {
  return (
    <motion.div
      key={data.device.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
    >
      <Panel
        title={`${data.device.name} · ready`}
        sub="Save this config now — the private key isn't stored on the server."
        className="border-status-online/40 bg-status-online/5"
      >
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="zv-qr-box bg-card flex shrink-0 items-center justify-center">
            <span
              className="block size-32"
              dangerouslySetInnerHTML={{ __html: data.qr_svg }}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-sm">
              Allocated IP:{" "}
              <span className="zv-kbd">{data.device.allocated_ip}</span>
            </p>
            <CopyableCode value={data.config} multiline />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              const blob = new Blob([data.config], { type: "text/plain" })
              const url = URL.createObjectURL(blob)
              const a = document.createElement("a")
              a.href = url
              a.download = `${data.device.name}.conf`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <IconDownload />
            Download .conf
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (copyText(data.config)) toast.success("Config copied")
              else toast.error("Failed to copy")
            }}
          >
            <IconQrcode />
            Copy config
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </Panel>
    </motion.div>
  )
}

function formatRate(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

