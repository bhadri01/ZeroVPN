import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconDeviceTablet, IconDownload, IconPlus, IconQrcode } from "@tabler/icons-react"
import { AnimatePresence, motion } from "motion/react"
import { useMemo, useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import {
  LiveIndicator,
  NetworkMonitorChart,
} from "@/components/charts/LazyNetworkMonitorChart"
import { BandwidthChart } from "@/components/charts/BandwidthChart"
import { CopyableCode } from "@/components/CopyableCode"
import { LiveEventStream } from "@/components/dashboard/LiveEventStream"
import { RecentActivity } from "@/components/dashboard/RecentActivity"
import { EmptyState } from "@/components/EmptyState"
import { Kpi, KpiStrip, PageHead, Panel, Seg } from "@/components/swiss"
import { StatusPill } from "@/components/StatusPill"
import { LiveTopology } from "@/components/topology/LiveTopology"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  type BandwidthRange,
  type CreatedDevice,
  type DeviceOs,
  adminListServers,
  createDevice,
  listDevices,
  userBandwidth,
} from "@/lib/api"
import { connState } from "@/lib/deviceState"
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
  const [range, setRange] = useState<BandwidthRange>("24h")

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

  const bandwidthQ = useQuery({
    queryKey: ["bandwidth", "user", range],
    queryFn: () => userBandwidth(range),
    refetchInterval: range === "24h" ? 30_000 : 5 * 60_000,
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

  const devices = devicesQ.data ?? []
  const active = devices.filter((d) => d.status === "active").length
  const paused = devices.filter((d) => d.status === "paused").length

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
    if (ids.length === 0) return { rx: [] as number[], tx: [] as number[] }
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
    if (maxLen === 0) return { rx: [], tx: [] }
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
    return { rx, tx }
  }, [onlineDeviceIds, liveDevices])

  const servers = serversQ.data ?? []
  const liveHubs = servers.filter((s) => s.is_active).length

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Workspace · 01"
        title="Dashboard"
        sub="Live network and devices for your account."
        right={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconPlus />
                Add device
              </Button>
            </DialogTrigger>
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
        }
      />

      {/* KPI strip — 4-up. Devices · TX · RX · (Hubs for admin / Paused for users) */}
      <KpiStrip>
        <Kpi
          label="Devices · live"
          value={active}
          unit={devices.length > 0 ? `/ ${devices.length}` : undefined}
          footL={paused > 0 ? `${paused} paused` : "all active"}
          footR={devicesQ.dataUpdatedAt ? "updated now" : ""}
          deltaTone="up"
        />
        <Kpi
          label="Throughput · TX"
          value={formatRate(totalTx)}
          spark={liveHistory.tx}
          sparkColor="var(--primary)"
          footL={
            onlineCount === 0
              ? "no online devices"
              : totalTx > 0
                ? "live"
                : "idle"
          }
        />
        <Kpi
          label="Throughput · RX"
          value={formatRate(totalRx)}
          spark={liveHistory.rx}
          sparkColor="var(--chart-1)"
          footL={
            onlineCount === 0
              ? "no online devices"
              : totalRx > 0
                ? "live"
                : "idle"
          }
        />
        {isAdmin ? (
          <Kpi
            label="Hubs · backbone"
            value={liveHubs}
            unit={servers.length > 0 ? `/ ${servers.length}` : undefined}
            footL={`${liveHubs}/${servers.length} reachable`}
            footR={serversQ.isLoading ? "…" : "live"}
          />
        ) : (
          <Kpi
            label="Devices · paused"
            value={paused}
            footL={paused === 0 ? "none paused" : "review on /devices"}
          />
        )}
      </KpiStrip>

      <AnimatePresence>
        {created && (
          <CreatedDeviceCard data={created} onClose={() => setCreated(null)} />
        )}
      </AnimatePresence>

      {/* Row 2: live topology (1fr) + live event stream (360px) */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Panel
          title="Live topology"
          sub="Worker → ZeroMQ → API → WS · sub-second"
          right={<LiveIndicator />}
          bodyClassName="p-0 aspect-[16/10] relative"
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
          />
        </Panel>

        <Panel
          title="Live event stream"
          sub="ws · /api/v1/ws"
          right={<LiveIndicator />}
          flush
        >
          <LiveEventStream />
        </Panel>
      </div>

      {/* Row 3: bandwidth — full width with range selector */}
      <Panel
        title="Bandwidth"
        sub={
          <>
            All devices · {range}{" "}
            <Link
              to="/app/bandwidth"
              className="hover:text-foreground underline"
            >
              · historical →
            </Link>
          </>
        }
        right={
          <Seg
            value={range}
            options={["24h", "7d", "30d"] as const}
            onChange={setRange}
          />
        }
      >
        {bandwidthQ.isLoading ? (
          <div className="text-muted-foreground border-border flex h-[220px] items-center justify-center border font-mono text-xs">
            Loading…
          </div>
        ) : bandwidthQ.isError ? (
          <div className="text-destructive border-border flex h-[220px] items-center justify-center border font-mono text-xs">
            Failed to load bandwidth.
          </div>
        ) : (
          <NetworkAggregateOrHistorical
            range={range}
            historical={bandwidthQ.data?.buckets ?? []}
            liveRxHistory={liveHistory.rx}
            liveTxHistory={liveHistory.tx}
          />
        )}
      </Panel>

      {/* Row 4: devices (1.4fr) + recent activity (1fr) */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Devices"
          sub={`${devices.length} total · ${active} live`}
          flush
          right={
            <Link
              to="/app/devices"
              className="text-muted-foreground hover:text-foreground font-mono text-xs"
            >
              View all ↗
            </Link>
          }
        >
          {devicesQ.isLoading && (
            <p className="text-muted-foreground p-4 font-mono text-sm">Loading…</p>
          )}
          {devicesQ.isError && (
            <p className="text-destructive p-4 font-mono text-sm">
              Failed to load devices.
            </p>
          )}
          {devicesQ.data && devicesQ.data.length === 0 && (
            <div className="p-4">
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
            </div>
          )}
          {devicesQ.data && devicesQ.data.length > 0 && (
            <table className="zv-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>OS</th>
                  <th>IP</th>
                  <th>Status</th>
                  <th className="zv-num">TX</th>
                  <th className="zv-num">RX</th>
                </tr>
              </thead>
              <tbody>
                {devicesQ.data.slice(0, 7).map((d) => {
                  const live = rates.get(d.id) ?? { rxBps: 0, txBps: 0 }
                  const online = connState(d) === "online"
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link
                          to={`/app/devices/${d.id}`}
                          className="hover:text-foreground inline-flex items-center gap-2 font-medium"
                        >
                          <span
                            className={`size-1.5 rounded-full ${online ? "bg-status-online" : d.status === "paused" ? "bg-status-degraded" : "bg-status-offline"}`}
                          />
                          {d.name}
                        </Link>
                      </td>
                      <td className="text-muted-foreground">{d.os}</td>
                      <td className="font-mono">{d.allocated_ip}</td>
                      <td>
                        <StatusPill
                          status={
                            d.status === "revoked"
                              ? "revoked"
                              : d.status === "paused"
                                ? "paused"
                                : online
                                  ? "online"
                                  : "offline"
                          }
                        />
                      </td>
                      <td className="zv-num">
                        {online ? (
                          formatRate(live.txBps)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="zv-num">
                        {online ? (
                          formatRate(live.rxBps)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>

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
      </div>
    </div>
  )
}

/** When live data is present, prefer the 60-frame WS-driven aggregate
 *  (matches the design's "feels alive" intent). Once the live histories
 *  drain or aren't populated yet, fall back to the historical buckets from
 *  the bandwidth API so the chart isn't blank. Both inputs are real. */
function NetworkAggregateOrHistorical({
  range,
  historical,
  liveRxHistory,
  liveTxHistory,
}: {
  range: BandwidthRange
  historical: { bucket_start: string; rx_bytes: number; tx_bytes: number }[]
  liveRxHistory: number[]
  liveTxHistory: number[]
}) {
  // For the 24h tab and when there's an active live stream, show the live
  // monitor (rates in bps over the last minute). Otherwise show the bucketed
  // historical chart (bytes per bucket).
  const haveLive = liveRxHistory.length > 0 || liveTxHistory.length > 0
  if (range === "24h" && haveLive) {
    return (
      <NetworkMonitorChart
        rxHistory={liveRxHistory}
        txHistory={liveTxHistory}
        variant="combined"
        height={220}
      />
    )
  }
  return <BandwidthChart buckets={historical} height={220} />
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
              void navigator.clipboard.writeText(data.config)
              toast.success("Config copied")
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

/** Best-effort CIDR derived from a device's allocated IP. Used purely as
 *  cosmetic meta on the topology hub — falls back to the bare IP if we
 *  can't parse it as IPv4. */
function deriveCidr(ip: string): string | undefined {
  const parts = ip.split(".")
  if (parts.length !== 4) return undefined
  return `${parts[0]}.${parts[1]}.0.0/16`
}
