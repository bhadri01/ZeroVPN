import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconDeviceTablet,
  IconDownload,
  IconPlus,
  IconQrcode,
} from "@tabler/icons-react"
import { AnimatePresence, motion } from "motion/react"
import { useMemo, useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import {
  LiveIndicator,
  NetworkMonitorChart,
} from "@/components/charts/LazyNetworkMonitorChart"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { EmptyState } from "@/components/EmptyState"
import {
  IconBtn,
  KpiStrip,
  Kpi,
  PageHead,
  Panel,
} from "@/components/swiss"
import { StatusPill } from "@/components/StatusPill"
import { TopologyGraph } from "@/components/topology/LazyTopologyGraph"
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
  type CreatedDevice,
  type DeviceOs,
  type DeviceStatus,
  createDevice,
  deleteDevice,
  listDevices,
  pauseDevice,
  unpauseDevice,
} from "@/lib/api"
import { aggregateLiveStats, useLiveStats } from "@/stores/liveStats"

export function DashboardPage() {
  const queryClient = useQueryClient()
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
  const [created, setCreated] = useState<CreatedDevice | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState("")
  const [osChoice, setOsChoice] = useState<DeviceOs>("other")
  const [revokeId, setRevokeId] = useState<string | null>(null)

  const liveDevices = useLiveStats((s) => s.devices)
  const liveAggregate = useMemo(
    () => aggregateLiveStats(liveDevices),
    [liveDevices],
  )
  const rates = useMemo(() => {
    const m = new Map<string, { rxBps: number; txBps: number }>()
    for (const [id, d] of Object.entries(liveDevices)) {
      m.set(id, { rxBps: d.rxBps, txBps: d.txBps })
    }
    return m
  }, [liveDevices])

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

  const pauseM = useMutation({
    mutationFn: (id: string) => pauseDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
      toast.info("Device paused")
    },
  })
  const unpauseM = useMutation({
    mutationFn: (id: string) => unpauseDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device active")
    },
  })
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteDevice(id),
    onSuccess: () => {
      setRevokeId(null)
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
      toast.warning("Device revoked")
    },
  })

  const devices = devicesQ.data ?? []
  const active = devices.filter((d) => d.status === "active").length
  const paused = devices.filter((d) => d.status === "paused").length
  const totalRx = Array.from(rates.values()).reduce((s, v) => s + v.rxBps, 0)
  const totalTx = Array.from(rates.values()).reduce((s, v) => s + v.txBps, 0)

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

      <KpiStrip>
        <Kpi
          label="Devices · live"
          value={active}
          unit={`/ ${devices.length}`}
          footL="up · this hour"
          footR="updated now"
          deltaTone="up"
        />
        <Kpi label="Paused" value={paused} footL="—" />
        <Kpi
          label="Throughput · TX"
          value={formatRate(totalTx)}
          spark={liveAggregate.txHistory.slice(-32)}
          sparkColor="var(--primary)"
        />
        <Kpi
          label="Throughput · RX"
          value={formatRate(totalRx)}
          spark={liveAggregate.rxHistory.slice(-32)}
          sparkColor="var(--chart-1)"
        />
      </KpiStrip>

      <AnimatePresence>
        {created && (
          <CreatedDeviceCard data={created} onClose={() => setCreated(null)} />
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel
          title="Live topology"
          sub="Worker → ZeroMQ → API → WS · sub-second"
          right={<LiveIndicator />}
          className="lg:col-span-3"
        >
          <TopologyGraph devices={devices} rates={rates} />
        </Panel>

        <Panel
          title="Network traffic"
          sub={
            <>
              Aggregate RX/TX, last 60 frames.{" "}
              <Link
                to="/app/bandwidth"
                className="hover:text-foreground underline"
              >
                Historical →
              </Link>
            </>
          }
          right={<LiveIndicator />}
          className="lg:col-span-2"
        >
          <NetworkMonitorChart
            rxHistory={liveAggregate.rxHistory}
            txHistory={liveAggregate.txHistory}
            variant="combined"
            height={220}
          />
        </Panel>
      </div>

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
                <th />
              </tr>
            </thead>
            <tbody>
              {devicesQ.data.map((d) => {
                const live = rates.get(d.id) ?? { rxBps: 0, txBps: 0 }
                return (
                  <tr key={d.id}>
                    <td>
                      <Link
                        to={`/app/devices/${d.id}`}
                        className="hover:text-foreground inline-flex items-center gap-2 font-medium"
                      >
                        <span
                          className={`size-1.5 rounded-full ${d.status === "active" ? "bg-status-online" : "bg-status-paused"}`}
                        />
                        {d.name}
                      </Link>
                    </td>
                    <td className="text-muted-foreground">{d.os}</td>
                    <td className="font-mono">{d.allocated_ip}</td>
                    <td>
                      <StatusPill status={d.status as Status} />
                    </td>
                    <td className="zv-num">{formatRate(live.txBps)}</td>
                    <td className="zv-num">{formatRate(live.rxBps)}</td>
                    <td className="zv-actions">
                      <DeviceActions
                        status={d.status}
                        onPause={() => pauseM.mutate(d.id)}
                        onUnpause={() => unpauseM.mutate(d.id)}
                        onRevoke={() => setRevokeId(d.id)}
                        pending={pauseM.isPending || unpauseM.isPending}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(o) => !o && setRevokeId(null)}
        title="Revoke device?"
        description="This removes the peer from WireGuard, frees its IP, and is irreversible. The user must re-add a new device to reconnect."
        confirmLabel="Revoke"
        destructive
        pending={deleteM.isPending}
        onConfirm={() => revokeId && deleteM.mutate(revokeId)}
      />
    </div>
  )
}

type Status =
  | "online"
  | "active"
  | "degraded"
  | "offline"
  | "paused"
  | "revoked"
  | "pending"

function DeviceActions({
  status,
  onPause,
  onUnpause,
  onRevoke,
  pending,
}: {
  status: DeviceStatus
  onPause: () => void
  onUnpause: () => void
  onRevoke: () => void
  pending: boolean
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {status === "active" && (
        <IconBtn onClick={onPause} title="Pause">
          ⏸
        </IconBtn>
      )}
      {status === "paused" && (
        <IconBtn onClick={onUnpause} title="Unpause">
          ▶
        </IconBtn>
      )}
      <IconBtn
        onClick={onRevoke}
        title={pending ? "Working…" : "Revoke"}
        className="hover:text-destructive hover:border-destructive"
      >
        ×
      </IconBtn>
    </span>
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
