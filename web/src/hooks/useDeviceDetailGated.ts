import { useAuth } from "@/stores/auth"

/**
 * Returns true when the user-facing /app/devices/{id} page is hidden from
 * the current session by the admin-set "Hide device detail" policy. Admins
 * are always exempt — they can still inspect any device. Pair with the
 * `DeviceDetailRoute` guard (which enforces the same rule on direct
 * navigation) so links, double-click handlers, and route entry all agree.
 */
export function useDeviceDetailGated(): boolean {
  return useAuth(
    (s) =>
      !!s.user &&
      s.user.role !== "admin" &&
      !!s.user.user_policy?.hide_device_detail,
  )
}
