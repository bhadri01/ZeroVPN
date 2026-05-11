import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconDeviceTablet, IconPlus } from "@tabler/icons-react"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { DeviceCard } from "@/components/DeviceCard"
import { EmptyState } from "@/components/EmptyState"
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
  ApiError,
  type CreatedDevice,
  type DeviceOs,
  createDevice,
  deleteDevice,
  listDevices,
  pauseDevice,
  unpauseDevice,
} from "@/lib/api"
import { useReducedMotion } from "@/lib/motion"

export function DevicesPage() {
  const qc = useQueryClient()
  const reduceMotion = useReducedMotion()
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })

  const [created, setCreated] = useState<CreatedDevice | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState("")
  const [osChoice, setOsChoice] = useState<DeviceOs>("other")
  const [revokeId, setRevokeId] = useState<string | null>(null)

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
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Workspace · 02"
        title="Devices"
        sub={`${devices.length} total · ${active} live`}
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
                  We generate a fresh keypair, allocate an IP, and hand you
                  a config. The private key never leaves the page.
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
        <Kpi label="Active" value={active} footL="streaming now" />
        <Kpi label="Paused" value={paused} footL="—" />
        <Kpi label="Revoked" value={revoked} footL="hard-removed" />
        <Kpi label="Total" value={devices.length} footL="all states" />
      </KpiStrip>

      <AnimatePresence>
        {created && (
          <motion.div
            key={created.device.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <Panel
              title={`${created.device.name} · ready`}
              sub="Save this config now — the private key isn't stored on the server."
              className="border-status-online/40 bg-status-online/5"
            >
              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <div className="zv-qr-box bg-card flex shrink-0 items-center justify-center">
                  <span
                    className="block size-32"
                    dangerouslySetInnerHTML={{ __html: created.qr_svg }}
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <CopyableCode value={created.config} multiline />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
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
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      {devicesQ.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-none" />
          ))}
        </div>
      )}
      {devicesQ.isError && (
        <p className="text-destructive font-mono text-sm">
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
      {devices.length > 0 && (
        <motion.div
          layout={!reduceMotion}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <AnimatePresence initial={false}>
            {devices.map((d) => (
              <motion.div
                key={d.id}
                layout={!reduceMotion}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18 }}
              >
                <DeviceCard
                  device={d}
                  onPause={(id) => pauseM.mutate(id)}
                  onUnpause={(id) => unpauseM.mutate(id)}
                  onRevoke={(id) => setRevokeId(id)}
                  pending={pauseM.isPending || unpauseM.isPending}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

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
