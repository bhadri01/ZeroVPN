import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ApiError,
  patchDevice,
  type DeviceOs,
  type DeviceType,
  type PublicDevice,
} from "@/lib/api"

// [value, label] — value stays the lowercase enum the API expects; the
// label is the brand-cased display string.
const OS_OPTIONS: [DeviceOs, string][] = [
  ["ios", "iOS"],
  ["android", "Android"],
  ["macos", "macOS"],
  ["windows", "Windows"],
  ["linux", "Linux"],
  ["other", "Other"],
]

const TYPE_OPTIONS: [DeviceType, string][] = [
  ["phone", "Phone"],
  ["tablet", "Tablet"],
  ["laptop", "Laptop"],
  ["desktop", "Desktop"],
  ["tv", "TV"],
  ["router", "Router"],
  ["watch", "Watch"],
  ["iot", "IoT"],
  ["server", "Server"],
  ["other", "Other"],
]

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

  const m = useMutation({
    mutationFn: () => {
      const next = name.trim()
      if (!next || next.length > 64) {
        throw new ApiError(422, "validation", "Name must be 1–64 characters")
      }
      // DNS resolvers are server-managed (not user-editable). The PATCH
      // overwrites dns_override with what it receives, so pass the device's
      // current value through to leave it untouched.
      return patchDevice(device.id, {
        name: next !== device.name ? next : undefined,
        os: os !== device.os ? os : undefined,
        device_type: deviceType !== device.device_type ? deviceType : undefined,
        dns_override: device.dns_override,
      })
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
  const canSave = trimmed.length > 0 && trimmed.length <= 64 && !m.isPending

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
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="zv-eyebrow">Operating system</Label>
            <Select value={os} onValueChange={(v) => setOs(v as DeviceOs)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OS_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="zv-eyebrow">Device type</Label>
            <Select
              value={deviceType}
              onValueChange={(v) => setDeviceType(v as DeviceType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
