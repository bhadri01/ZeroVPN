import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"

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
import { OptionTiles } from "@/components/devices/OptionTiles"
import {
  ApiError,
  myUsage,
  patchDevice,
  setMyDeviceQuota,
  type DeviceOs,
  type DeviceType,
  type PublicDevice,
} from "@/lib/api"
import { DEVICE_TYPE_OPTIONS, OS_OPTIONS } from "@/lib/deviceIcons"
import { formatBytes } from "@/lib/units"

/**
 * Shared "edit device" dialog — name, OS, device type, and custom DNS. The
 * metadata fields are labels; DNS rewrites the config, so it takes effect
 * once the user re-downloads the .conf. Used from the device-detail header
 * and the list/grid 3-dot menus so both stay in sync. (Tunnel routing is
 * always full-tunnel — there's no split option.)
 */
export function EditDeviceDialog({
  device,
  open,
  onOpenChange,
}: {
  device: PublicDevice | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {device && (
          // Keyed by id so switching which device is being edited (or
          // re-opening) remounts the form with fresh state seeded straight
          // from `device` — no setState-in-effect needed.
          <EditDeviceForm
            key={device.id}
            device={device}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditDeviceForm({
  device,
  onClose,
}: {
  device: PublicDevice
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(device.name)
  const [os, setOs] = useState<DeviceOs>(device.os)
  const [deviceType, setDeviceType] = useState<DeviceType>(device.device_type)
  const [capGbInput, setCapGbInput] = useState(
    device.monthly_byte_cap && device.monthly_byte_cap > 0
      ? formatCapGb(device.monthly_byte_cap)
      : "",
  )

  // Account cap — bounds the per-device cap input; surfaced as a hint
  // and as the client-side max so the user sees the constraint before
  // submit (the server clamps too).
  const usageQ = useQuery({ queryKey: ["me", "usage"], queryFn: myUsage })
  const accountCapBytes = usageQ.data?.monthly_byte_cap ?? null

  const capValidation = useMemo<{
    ok: boolean
    bytes: number | null
    error: string | null
  }>(() => {
    const raw = capGbInput.trim()
    if (!raw) return { ok: true, bytes: null, error: null }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, bytes: null, error: "must be a positive number of GB" }
    }
    const bytes = Math.round(n * 1024 ** 3)
    if (accountCapBytes && bytes > accountCapBytes) {
      return {
        ok: false,
        bytes,
        error: `can't exceed your account cap (${formatBytes(accountCapBytes)})`,
      }
    }
    return { ok: true, bytes: bytes > 0 ? bytes : null, error: null }
  }, [capGbInput, accountCapBytes])

  const m = useMutation({
    mutationFn: async () => {
      const next = name.trim()
      if (!next || next.length > 64) {
        throw new ApiError(422, "validation", "Name must be 1–64 characters")
      }
      // DNS resolvers are server-managed (not user-editable). The PATCH
      // overwrites dns_override with what it receives, so pass the device's
      // current value through to leave it untouched.
      await patchDevice(device.id, {
        name: next !== device.name ? next : undefined,
        os: os !== device.os ? os : undefined,
        device_type: deviceType !== device.device_type ? deviceType : undefined,
        dns_override: device.dns_override,
      })
      // Cap rides on a separate endpoint so it doesn't need its own
      // COALESCE branch in PATCH /devices/{id}. Only fire when the value
      // actually changed so we don't generate redundant audit rows.
      const nextCap = capValidation.bytes
      const prevCap =
        device.monthly_byte_cap && device.monthly_byte_cap > 0
          ? device.monthly_byte_cap
          : null
      if (nextCap !== prevCap) {
        await setMyDeviceQuota(device.id, nextCap)
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["devices"] })
      void qc.invalidateQueries({ queryKey: ["device", device.id] })
      onClose()
      toast.success("Device updated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
      else toast.error("Failed to update device")
    },
  })

  const trimmed = name.trim()
  const canSave =
    trimmed.length > 0 &&
    trimmed.length <= 64 &&
    capValidation.ok &&
    !m.isPending

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit device</DialogTitle>
        <DialogDescription>
          Update the device's name, operating system, and type.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-dev-name" className="zv-eyebrow">
            Name
          </Label>
          <Input
            id="edit-dev-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            autoFocus
            className="font-mono"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) {
                e.preventDefault()
                m.mutate()
              }
            }}
          />
          <p className="text-muted-foreground font-mono text-[11px]">
            1–64 characters.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="zv-eyebrow">Operating system</Label>
          <OptionTiles
            ariaLabel="Operating system"
            options={OS_OPTIONS}
            value={os}
            onChange={setOs}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="zv-eyebrow">Device type</Label>
          <OptionTiles
            ariaLabel="Device type"
            options={DEVICE_TYPE_OPTIONS}
            value={deviceType}
            onChange={setDeviceType}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-dev-cap" className="zv-eyebrow">
            Monthly cap
            {accountCapBytes && accountCapBytes > 0 && (
              <span className="text-muted-foreground/70 normal-case">
                {" "}· account cap{" "}
                <span className="text-foreground font-mono">
                  {formatBytes(accountCapBytes)}
                </span>
              </span>
            )}
          </Label>
          <div
            data-invalid={!capValidation.ok ? "1" : undefined}
            className="border-input bg-transparent focus-within:border-ring focus-within:ring-ring/50 data-[invalid=1]:border-destructive data-[invalid=1]:ring-destructive/20 flex h-8 items-stretch overflow-hidden rounded-lg border transition-colors focus-within:ring-3 data-[invalid=1]:ring-3"
          >
            <input
              id="edit-dev-cap"
              type="number"
              min={0}
              step="0.1"
              value={capGbInput}
              onChange={(e) => setCapGbInput(e.target.value)}
              placeholder={
                accountCapBytes && accountCapBytes > 0
                  ? formatCapGb(accountCapBytes)
                  : "unlimited"
              }
              className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent px-2.5 py-1 font-mono text-sm outline-none"
            />
            <span className="border-input bg-muted/40 text-muted-foreground inline-flex shrink-0 items-center border-l px-2.5 font-mono text-[12px]">
              GB / month
            </span>
          </div>
          <p className="text-muted-foreground font-mono text-[11px]">
            {accountCapBytes && accountCapBytes > 0
              ? "Leave blank to use the account cap. Lower it to throttle this device alone."
              : "Your account has no cap — blank means unlimited; set a value to throttle this device alone."}
            {capValidation.error && (
              <span className="text-destructive ml-2">
                {capValidation.error}
              </span>
            )}
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
          Cancel
        </Button>
        <Button onClick={() => m.mutate()} disabled={!canSave}>
          {m.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Render a byte count as a GB string suited to a numeric `<input>` —
 *  whole GB when the value rounds cleanly, otherwise one decimal place
 *  so the seed value round-trips without "the cap silently changed by
 *  0.1 GB on save" surprises. */
function formatCapGb(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 10) return Math.round(gb).toString()
  return gb.toFixed(1).replace(/\.0$/, "")
}
