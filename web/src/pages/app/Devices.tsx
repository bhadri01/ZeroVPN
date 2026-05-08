import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconDevicesPc,
  IconDeviceTablet,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { EmptyState } from "@/components/EmptyState"
import { PageHeader } from "@/components/PageHeader"
import { RelativeTime } from "@/components/RelativeTime"
import { applyEmaSmoothing } from "@/components/topology/LazyTopologyGraph"
import { Stat } from "@/components/Stat"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useWebSocket } from "@/hooks/useWebSocket"
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
import type { Event } from "@/lib/wire"
import { useAuth } from "@/stores/auth"

export function DevicesPage() {
  const user = useAuth((s) => s.user)
  const qc = useQueryClient()
  const reduceMotion = useReducedMotion()
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })

  const [created, setCreated] = useState<CreatedDevice | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState("")
  const [osChoice, setOsChoice] = useState<DeviceOs>("other")
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [rates, setRates] = useState<
    Map<string, { rxBps: number; txBps: number }>
  >(new Map())

  const onWsEvent = useCallback(
    (event: Event) => {
      if (event.type === "stats_delta") {
        setRates((prev) =>
          applyEmaSmoothing(prev, {
            deviceId: event.device_id,
            rxBps: event.rate_rx_bps,
            txBps: event.rate_tx_bps,
          }),
        )
      } else if (event.type === "peer_status_changed") {
        void qc.invalidateQueries({ queryKey: ["devices"] })
      }
    },
    [qc],
  )

  useWebSocket({
    path: "/api/v1/ws",
    onEvent: onWsEvent,
    enabled: !!user,
  })

  const addM = useMutation({
    mutationFn: () => createDevice({ name: name.trim(), os: osChoice }),
    onSuccess: (data) => {
      setCreated(data)
      setName("")
      setAddOpen(false)
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device added")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })
  const pauseM = useMutation({
    mutationFn: (id: string) => pauseDevice(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.info("Device paused")
    },
  })
  const unpauseM = useMutation({
    mutationFn: (id: string) => unpauseDevice(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device active")
    },
  })
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteDevice(id),
    onSuccess: () => {
      setRevokeId(null)
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.warning("Device revoked")
    },
  })

  const devices = devicesQ.data ?? []
  const active = devices.filter((d) => d.status === "active").length
  const paused = devices.filter((d) => d.status === "paused").length
  const revoked = devices.filter((d) => d.status === "revoked").length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devices"
        description="Every WireGuard peer attached to your account."
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
                  We generate a fresh keypair, allocate an IP, and hand you
                  a config. The private key never leaves the page.
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

      <div className="grid grid-cols-3 gap-3 md:grid-cols-3">
        <Stat label="Active" value={active} />
        <Stat label="Paused" value={paused} />
        <Stat label="Revoked" value={revoked} />
      </div>

      <AnimatePresence>
        {created && (
          <motion.div
            key={created.device.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <Card className="border-status-online/30 bg-status-online/5">
              <CardContent className="space-y-4 pt-6">
                <div>
                  <p className="text-sm font-medium">
                    {created.device.name} · ready
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Save this config now — the private key isn't stored on
                    the server.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                  <div className="flex shrink-0 items-center justify-center rounded-md bg-white p-2">
                    <span
                      className="block size-32"
                      dangerouslySetInnerHTML={{ __html: created.qr_svg }}
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <CopyableCode value={created.config} multiline />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const blob = new Blob([created.config], {
                        type: "text/plain",
                      })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = `${created.device.name}.conf`
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                  >
                    Download .conf
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                    Done
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card>
        <CardContent>
          {devicesQ.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          {devicesQ.isError && (
            <p className="text-destructive text-sm">Failed to load devices.</p>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Last handshake</TableHead>
                  <TableHead className="hidden sm:table-cell">Live</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence initial={false}>
                  {devicesQ.data.map((d) => {
                    const live = rates.get(d.id) ?? { rxBps: 0, txBps: 0 }
                    return (
                      <motion.tr
                        key={d.id}
                        layout={!reduceMotion}
                        variants={listVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <TableCell>
                          <Link
                            to={`/app/devices/${d.id}`}
                            className="hover:text-primary flex items-center gap-2 transition-colors"
                          >
                            <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
                              <IconDevicesPc className="size-3.5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {d.name}
                              </span>
                              <span className="text-muted-foreground block text-xs">
                                {d.os}
                              </span>
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {d.allocated_ip}
                        </TableCell>
                        <TableCell className="text-xs">
                          <RelativeTime
                            value={d.last_handshake_at}
                            fallback="Never"
                          />
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground text-xs tabular-nums sm:table-cell">
                          ↑ {formatBps(live.txBps)} · ↓ {formatBps(live.rxBps)}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={d.status as Status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <DeviceActions
                            status={d.status}
                            onPause={() => pauseM.mutate(d.id)}
                            onUnpause={() => unpauseM.mutate(d.id)}
                            onRevoke={() => setRevokeId(d.id)}
                            pending={pauseM.isPending || unpauseM.isPending}
                          />
                        </TableCell>
                      </motion.tr>
                    )
                  })}
                </AnimatePresence>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(o) => !o && setRevokeId(null)}
        title="Revoke device?"
        description="This removes the peer from WireGuard, frees its IP, and is irreversible."
        confirmLabel="Revoke"
        destructive
        pending={deleteM.isPending}
        onConfirm={() => revokeId && deleteM.mutate(revokeId)}
      />
    </div>
  )
}

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
    <div className="inline-flex items-center gap-1">
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

function formatBps(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}
