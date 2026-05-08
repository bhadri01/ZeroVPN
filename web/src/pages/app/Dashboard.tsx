import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconDevicesPc,
  IconDeviceTablet,
  IconDownload,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconQrcode,
  IconTrash,
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
import { PageHeader } from "@/components/PageHeader"
import { Stat } from "@/components/Stat"
import { StatusPill } from "@/components/StatusPill"
import { TopologyGraph } from "@/components/topology/LazyTopologyGraph"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { listVariants, useReducedMotion } from "@/lib/motion"
import { aggregateLiveStats, useLiveStats } from "@/stores/liveStats"

export function DashboardPage() {
  const queryClient = useQueryClient()
  const reduceMotion = useReducedMotion()
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
  const [created, setCreated] = useState<CreatedDevice | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState("")
  const [osChoice, setOsChoice] = useState<DeviceOs>("other")
  const [revokeId, setRevokeId] = useState<string | null>(null)

  // Live rates come from the shared store fed by LiveStatsProvider in
  // DashboardLayout. Both `rates` (for the topology graph) and the
  // aggregate stream (for the bandwidth card) are derived via useMemo
  // off the stable `devices` reference — calling
  // `useLiveStats(aggregateLiveStats)` directly would return a fresh
  // object on every read and trip useSyncExternalStore (React #185).
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
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Live network and devices for your account."
        actions={
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
                <div className="space-y-1.5">
                  <Label htmlFor="dev-name">Name</Label>
                  <Input
                    id="dev-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Pixel 8, MacBook Pro…"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Operating system</Label>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active devices" value={active} />
        <Stat label="Paused" value={paused} />
        <Stat
          label="RX total"
          value={totalRx}
          format={formatBps}
          unit="now"
        />
        <Stat
          label="TX total"
          value={totalTx}
          format={formatBps}
          unit="now"
        />
      </div>

      <AnimatePresence>
        {created && <CreatedDeviceCard data={created} onClose={() => setCreated(null)} />}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Live network</CardTitle>
            <CardDescription>
              Particles flow with traffic; speed scales with rate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TopologyGraph devices={devices} rates={rates} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Network traffic</CardTitle>
              <CardDescription>
                Aggregate RX/TX, last 60 frames. Visit{" "}
                <Link to="/app/bandwidth" className="hover:text-foreground underline">
                  Bandwidth
                </Link>{" "}
                for historical.
              </CardDescription>
            </div>
            <LiveIndicator />
          </CardHeader>
          <CardContent>
            <NetworkMonitorChart
              rxHistory={liveAggregate.rxHistory}
              txHistory={liveAggregate.txHistory}
              variant="combined"
              height={220}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Devices</CardTitle>
            <CardDescription>
              Per-device status and live throughput.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {devicesQ.isLoading && (
            <p className="text-muted-foreground text-sm">Loading…</p>
          )}
          {devicesQ.isError && (
            <p className="text-destructive text-sm">
              Failed to load devices.
            </p>
          )}
          {devicesQ.data && devicesQ.data.length === 0 && (
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
          )}
          {devicesQ.data && devicesQ.data.length > 0 && (
            <ul className="divide-border -mx-1 divide-y">
              <AnimatePresence initial={false}>
                {devicesQ.data.map((d) => {
                  const live = rates.get(d.id) ?? { rxBps: 0, txBps: 0 }
                  return (
                    <motion.li
                      key={d.id}
                      layout={!reduceMotion}
                      variants={listVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="hover:bg-muted/30 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors"
                    >
                      <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
                        <IconDevicesPc className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {d.os} · {d.allocated_ip}
                        </p>
                      </div>
                      <span className="text-muted-foreground hidden text-xs tabular-nums sm:inline">
                        ↑ {formatBps(live.txBps)} · ↓ {formatBps(live.rxBps)}
                      </span>
                      <StatusPill status={d.status as Status} />
                      <DeviceActions
                        status={d.status}
                        onPause={() => pauseM.mutate(d.id)}
                        onUnpause={() => unpauseM.mutate(d.id)}
                        onRevoke={() => setRevokeId(d.id)}
                        pending={pauseM.isPending || unpauseM.isPending}
                      />
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          )}
        </CardContent>
      </Card>

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
    <div className="flex items-center gap-1">
      {status === "active" && (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onPause}
          disabled={pending}
          title="Pause"
        >
          <IconPlayerPause className="size-3.5" />
        </Button>
      )}
      {status === "paused" && (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onUnpause}
          disabled={pending}
          title="Unpause"
        >
          <IconPlayerPlay className="size-3.5" />
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onRevoke}
        disabled={status === "revoked"}
        title="Revoke"
        className="text-muted-foreground hover:text-destructive"
      >
        <IconTrash className="size-3.5" />
      </Button>
    </div>
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
      <Card className="border-status-online/30 bg-status-online/5">
        <CardHeader>
          <CardTitle className="text-base">
            {data.device.name} · ready
          </CardTitle>
          <CardDescription>
            Save this config now — the private key isn't stored on the
            server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="flex shrink-0 items-center justify-center rounded-md bg-white p-2">
              <span
                className="block size-32"
                dangerouslySetInnerHTML={{ __html: data.qr_svg }}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-sm">
                Allocated IP:{" "}
                <code className="bg-muted rounded px-1 text-xs">
                  {data.device.allocated_ip}
                </code>
              </p>
              <CopyableCode value={data.config} multiline />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
        </CardContent>
      </Card>
    </motion.div>
  )
}

function formatBps(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}
