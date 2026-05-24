import {
  IconBrandAndroid,
  IconBrandApple,
  IconBrandUbuntu,
  IconBrandWindows,
  IconCpu,
  IconDeviceDesktop,
  IconDeviceLaptop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconDeviceTv,
  IconDeviceUnknown,
  IconDeviceWatch,
  IconDevices,
  IconRouter,
  IconServer,
  type Icon,
} from "@tabler/icons-react"

import type { DeviceOs, DeviceType } from "@/lib/api"

export interface OsOption {
  value: DeviceOs
  label: string
  Icon: Icon
}

export interface DeviceTypeOption {
  value: DeviceType
  label: string
  Icon: Icon
}

/**
 * Selectable operating systems, each with a brand icon. `"other"` is
 * intentionally omitted — device create + edit require a concrete choice.
 * Legacy rows that still carry `"other"` fall back to a generic icon via
 * {@link osIcon} so they still render everywhere.
 *
 * iOS and macOS share the Apple mark by design.
 */
export const OS_OPTIONS: OsOption[] = [
  { value: "ios", label: "iOS", Icon: IconBrandApple },
  { value: "android", label: "Android", Icon: IconBrandAndroid },
  { value: "macos", label: "macOS", Icon: IconBrandApple },
  { value: "windows", label: "Windows", Icon: IconBrandWindows },
  { value: "linux", label: "Linux", Icon: IconBrandUbuntu },
]

/**
 * Selectable device form factors, each with a representative icon. `"other"`
 * is omitted for the same reason as {@link OS_OPTIONS}; {@link deviceTypeIcon}
 * supplies a fallback for any legacy `"other"` rows.
 */
export const DEVICE_TYPE_OPTIONS: DeviceTypeOption[] = [
  { value: "phone", label: "Phone", Icon: IconDeviceMobile },
  { value: "tablet", label: "Tablet", Icon: IconDeviceTablet },
  { value: "laptop", label: "Laptop", Icon: IconDeviceLaptop },
  { value: "desktop", label: "Desktop", Icon: IconDeviceDesktop },
  { value: "tv", label: "TV", Icon: IconDeviceTv },
  { value: "router", label: "Router", Icon: IconRouter },
  { value: "watch", label: "Watch", Icon: IconDeviceWatch },
  { value: "iot", label: "IoT", Icon: IconCpu },
  { value: "server", label: "Server", Icon: IconServer },
]

/**
 * Icon lookup maps keyed by enum value, including the legacy `"other"`
 * fallback. These are plain objects (member access) on purpose: consumers do
 * `const TypeIcon = DEVICE_TYPE_ICONS[d.device_type]`, which the react-compiler
 * lint treats like any stable component reference — a function call returning a
 * component in render scope (`deviceTypeIcon(x)`) would instead be flagged as
 * "creating a component during render".
 */
export const OS_ICONS: Record<DeviceOs, Icon> = {
  ios: IconBrandApple,
  android: IconBrandAndroid,
  macos: IconBrandApple,
  windows: IconBrandWindows,
  linux: IconBrandUbuntu,
  other: IconDevices,
}

export const DEVICE_TYPE_ICONS: Record<DeviceType, Icon> = {
  phone: IconDeviceMobile,
  tablet: IconDeviceTablet,
  laptop: IconDeviceLaptop,
  desktop: IconDeviceDesktop,
  tv: IconDeviceTv,
  router: IconRouter,
  watch: IconDeviceWatch,
  iot: IconCpu,
  server: IconServer,
  other: IconDeviceUnknown,
}

const OS_LABELS: Record<DeviceOs, string> = {
  ios: "iOS",
  android: "Android",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  other: "Other",
}

const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  phone: "Phone",
  tablet: "Tablet",
  laptop: "Laptop",
  desktop: "Desktop",
  tv: "TV",
  router: "Router",
  watch: "Watch",
  iot: "IoT",
  server: "Server",
  other: "Other",
}

/** Display label for a device's OS. */
export function osLabel(os: DeviceOs): string {
  return OS_LABELS[os] ?? "Other"
}

/** Display label for a device's form factor. */
export function deviceTypeLabel(type: DeviceType): string {
  return DEVICE_TYPE_LABELS[type] ?? "Other"
}
