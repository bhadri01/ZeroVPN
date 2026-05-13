/**
 * Thin fetch wrapper. Adds versioned base path, JSON serialization,
 * normalized errors, and credentials inclusion for session cookies.
 */

const BASE = (import.meta.env.VITE_API_BASE ?? "/api/v1").replace(/\/$/, "")

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; request_id?: string }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  headers.set("Accept", "application/json")

  const res = await fetch(url, { ...init, headers, credentials: "include" })

  if (!res.ok) {
    let body: ApiErrorBody = {}
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      // ignore
    }
    throw new ApiError(
      res.status,
      body.error?.code ?? `http_${res.status}`,
      body.error?.message ?? res.statusText,
      body.error?.request_id,
    )
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// --- types ---------------------------------------------------------------

export type UserRole = "admin" | "user"
export type DeviceOs = "ios" | "android" | "macos" | "windows" | "linux" | "other"
export type DeviceStatus = "active" | "paused" | "revoked"
export type UserStatus =
  | "active"
  | "suspended"
  | "pending_verification"
  | "deleted"

export interface PingResponse {
  pong: boolean
  ts_ms: number
}

export interface PublicUser {
  id: string
  email: string
  role: UserRole
  /** True when the user has finished TOTP enrollment. Surfaced by
   *  `/me` and the login / verify-email responses so the Security
   *  page can auto-detect 2FA state without an extra round-trip. */
  totp_enabled: boolean
  /** True when the active session is an admin impersonating this account. */
  is_impersonated?: boolean
  /** Email of the admin who initiated impersonation. Only present when
   *  `is_impersonated` is true. */
  impersonator_email?: string
}

export interface LoginResponse {
  user: PublicUser
  must_change_password: boolean
  totp_required: boolean
}

export interface PublicDevice {
  id: string
  user_id: string
  name: string
  os: DeviceOs
  public_key: string
  allocated_ip: string
  status: DeviceStatus
  server_id: string
  dns_names: string[]
  allowed_ips_override: string[] | null
  dns_override: string[] | null
  last_handshake_at: string | null
  created_at: string
  /** Presence flag: the server holds a KEK-encrypted copy of the
   *  device's WG private key. Enables re-download via
   *  `GET /devices/{id}/conf`. The key itself is never exposed by
   *  list / get responses. */
  private_key_stored: boolean
}

export interface CreatedDevice {
  device: PublicDevice
  config: string
  qr_svg: string
}

// --- endpoints -----------------------------------------------------------

export const ping = () => apiFetch<PingResponse>("/ping")

export const register = (body: { email: string; password: string }) =>
  apiFetch<{ status: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  })

export const login = (body: {
  email: string
  password: string
  totp_code?: string
}) =>
  apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  })

export const logout = () =>
  apiFetch<{ status: string }>("/auth/logout", { method: "POST" })

export const me = () => apiFetch<PublicUser>("/me")

/** Public-safe info about the user's WG server — used by the create-device
 * dialog to pre-fill defaults (DNS, split-tunnel CIDR) and render hints
 * ("must be inside <cidr>"). */
export interface MyServerInfo {
  cidr: string
  dns_servers: string[]
  endpoint_host: string
  endpoint_port: number
  mtu: number
}

export const meServer = () => apiFetch<MyServerInfo>("/me/server")

// ── User preferences ──────────────────────────────────────────────────
// Settings-page values the server persists per-user so they sync across
// signed-in sessions. Appearance/theme stay client-local (localStorage)
// to avoid a flash of wrong paint on first render.

export type UnitsPref = "bps" | "Bps"
export type DateFormatPref = "iso" | "us" | "eu"
export type TimeFormatPref = "h24" | "h12"
export type DefaultLandingPref = "dashboard" | "devices" | "topology"
export type ToastPositionPref =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"

export interface UserPreferences {
  units: UnitsPref
  date_format: DateFormatPref
  time_format: TimeFormatPref
  reduced_motion: boolean
  default_landing: DefaultLandingPref
  toast_position: ToastPositionPref
  toast_sound: boolean
  browser_notifications: boolean
}

export const getMyPreferences = () =>
  apiFetch<UserPreferences>("/me/preferences")

export const setMyPreferences = (patch: Partial<UserPreferences>) =>
  apiFetch<UserPreferences>("/me/preferences", {
    method: "PUT",
    body: JSON.stringify(patch),
  })

// ── Topology positions ─────────────────────────────────────────────────
// Per-user saved arrangement for the live-topology drag UI. Round-trip
// shape matches what we keep in localStorage: a flat {node_id: {x, y}}.

export interface TopologyPosition {
  x: number
  y: number
}

export interface TopologyPositionsResponse {
  positions: Record<string, TopologyPosition>
}

export const getMyTopology = () =>
  apiFetch<TopologyPositionsResponse>("/me/topology")

export const setMyTopology = (positions: Record<string, TopologyPosition>) =>
  apiFetch<{ status: string; count: number }>("/me/topology", {
    method: "PUT",
    body: JSON.stringify({ positions }),
  })

/** Verify-email response. The server upgrades the caller's session as
 *  part of a successful verify so the frontend can navigate straight to
 *  /app without an additional sign-in hop. */
export interface VerifyEmailResponse {
  status: string
  user: PublicUser
}
export const verifyEmail = (token: string) =>
  apiFetch<VerifyEmailResponse>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  })

export const resendVerify = (email: string) =>
  apiFetch<{ status: string }>("/auth/resend-verify", {
    method: "POST",
    body: JSON.stringify({ email }),
  })

export const forgotPassword = (email: string) =>
  apiFetch<{ status: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  })

export const resetPassword = (token: string, new_password: string) =>
  apiFetch<{ status: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password }),
  })

/** Authenticated change-password. Used by the in-app Settings → Security
 *  panel — keeps the current session alive while invalidating every
 *  other session for this user. */
export const changePassword = (
  current_password: string,
  new_password: string,
) =>
  apiFetch<{ status: string }>("/me/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password, new_password }),
  })

/** Pre-flight check for a reset-password link. Lets the form surface
 *  an "expired" state before the user types a new password. `reason`
 *  distinguishes "invalid" (no such token — usually a stale link from a
 *  reset DB or a mangled URL), "used" (consumed, typically because the
 *  user requested a newer reset email after this one), "expired" (past
 *  TTL), or "wrong_purpose". Omitted when valid. */
export interface ResetTokenCheck {
  valid: boolean
  reason?: "invalid" | "used" | "wrong_purpose" | "expired"
}
export const verifyResetToken = (token: string) =>
  apiFetch<ResetTokenCheck>("/auth/verify-reset-token", {
    method: "POST",
    body: JSON.stringify({ token }),
  })

export const listDevices = () => apiFetch<PublicDevice[]>("/devices")

export const getDevice = (id: string) => apiFetch<PublicDevice>(`/devices/${id}`)

export const createDevice = (body: {
  name: string
  os?: DeviceOs
  split_tunnel?: boolean
  dns_override?: string[]
  /** Optional manual IPv4 — when set, the server reserves exactly this
   *  address. Omit to let the allocator pick the next free slot. */
  allocated_ip?: string
  /** When true, the server encrypts the generated WG private key with
   *  its KEK and persists it on the device row so the user can re-
   *  download the .conf later. Default false (zero-knowledge). */
  store_private_key?: boolean
}) =>
  apiFetch<CreatedDevice>("/devices", {
    method: "POST",
    body: JSON.stringify(body),
  })

/** Re-render the device's .conf from the server's stored private key.
 *  Returns the same shape as `createDevice` so the existing "device
 *  created" dialog UI can render it. Requires the device to have been
 *  created with `store_private_key: true`. */
export const redownloadDeviceConf = (id: string) =>
  apiFetch<CreatedDevice>(`/devices/${id}/conf`)

export const patchDevice = (
  id: string,
  body: {
    name?: string
    os?: DeviceOs
    allowed_ips_override?: string[] | null
    dns_override?: string[] | null
  },
) =>
  apiFetch<{ status: string }>(`/devices/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })

export const deleteDevice = (id: string) =>
  apiFetch<{ status: string }>(`/devices/${id}`, { method: "DELETE" })

export const pauseDevice = (id: string) =>
  apiFetch<{ status: string }>(`/devices/${id}/pause`, { method: "POST" })

export const unpauseDevice = (id: string) =>
  apiFetch<{ status: string }>(`/devices/${id}/unpause`, { method: "POST" })

/** Regenerate the device's keypair server-side. Returns the same shape
 *  as `createDevice` — the device row, a freshly rendered wg-conf with
 *  the new private key, and a QR SVG. The old config stops working the
 *  moment this call returns; the user must re-import / re-scan.
 *
 *  Optional `store_private_key` overrides the device's existing opt-in:
 *   - `true`  → store (KEK-encrypt) the rotated key on the server
 *   - `false` → don't store, and clear any prior stored key
 *   - omit    → keep whatever the device was already doing */
export const rotateDeviceKeys = (
  id: string,
  opts: { store_private_key?: boolean } = {},
) =>
  apiFetch<CreatedDevice>(`/devices/${id}/rotate-keys`, {
    method: "POST",
    body: JSON.stringify(opts),
  })

/** Stop storing the device's encrypted private key on the server. The
 *  tunnel keeps working — only the recovery path (re-download .conf
 *  without rotating) is gone. */
export const clearStoredDeviceKey = (id: string) =>
  apiFetch<{ status: string; private_key_stored: boolean }>(
    `/devices/${id}/stored-key`,
    { method: "DELETE" },
  )

/** Persist the user's preferred device order. The server bulk-assigns
 *  `display_order` so the arrangement reflects on every signed-in
 *  session. `ids` must be the full set of the caller's device ids in
 *  the new order. */
export const reorderDevices = (ids: string[]) =>
  apiFetch<{ status: string; updated: number }>("/devices/order", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  })

export const setDeviceDns = (id: string, dns_names: string[]) =>
  apiFetch<{ dns_names: string[] }>(`/devices/${id}/dns`, {
    method: "PUT",
    body: JSON.stringify({ dns_names }),
  })

/** A single entry in the device's activity timeline. `action` is a dotted
 *  identifier — see the action catalogue in DeviceTimeline. `metadata`
 *  is an opaque JSON blob shaped per-action. */
export interface DeviceEvent {
  id: number
  action: string
  metadata: Record<string, unknown>
  created_at: string
}

export const listDeviceEvents = (id: string, limit = 100) =>
  apiFetch<DeviceEvent[]>(`/devices/${id}/events?limit=${limit}`)

/** Pre-flight DNS-name availability probe used by the create-device
 *  dialog. Returns whether the candidate FQDN matches the server regex
 *  and whether it's currently held by some other device. */
export interface DnsCheck {
  valid: boolean
  available: boolean
  reason?: "invalid" | "taken"
}
export const checkDnsName = (name: string) =>
  apiFetch<DnsCheck>(
    `/devices/dns-check?name=${encodeURIComponent(name)}`,
  )

// --- bandwidth -----------------------------------------------------------

export type BandwidthRange = "24h" | "7d" | "30d"

export interface BandwidthBucket {
  bucket_start: string
  rx_bytes: number
  tx_bytes: number
}

export interface BandwidthResponse {
  bucket: "hour" | "day"
  range: BandwidthRange
  buckets: BandwidthBucket[]
}

export const userBandwidth = (range: BandwidthRange = "24h") =>
  apiFetch<BandwidthResponse>(`/bandwidth?range=${range}`)

export const deviceBandwidth = (id: string, range: BandwidthRange = "24h") =>
  apiFetch<BandwidthResponse>(`/devices/${id}/bandwidth?range=${range}`)

// --- raw tick-level history (server-side bandwidth_samples / server_samples) ---
// Used to hydrate the live charts on page load. The chart then continues
// from `Event::StatsDelta` / `Event::ServerSample` arriving over the WS.

export interface DeviceHistoryPoint {
  sampled_at: string
  rx_bytes: number
  tx_bytes: number
}

export interface DeviceHistoryResponse {
  device_id: string
  from: string
  to: string
  samples: DeviceHistoryPoint[]
}

export interface ServerHistoryPoint {
  sampled_at: string
  total_rx_bytes: number
  total_tx_bytes: number
  peer_count: number
  online_count: number
  handshake_count: number
}

export interface ServerHistoryResponse {
  server_id: string
  from: string
  to: string
  samples: ServerHistoryPoint[]
}

interface HistoryOpts {
  /** RFC3339 (`new Date(...).toISOString()`). Default: now - 5 min. */
  from?: string
  /** RFC3339. Default: now. */
  to?: string
  /** Row limit. Hard cap server-side: 10000. */
  limit?: number
}

function historyQs(opts?: HistoryOpts): string {
  const params = new URLSearchParams()
  if (opts?.from) params.set("from", opts.from)
  if (opts?.to) params.set("to", opts.to)
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit))
  const s = params.toString()
  return s ? `?${s}` : ""
}

export const deviceHistory = (id: string, opts?: HistoryOpts) =>
  apiFetch<DeviceHistoryResponse>(`/devices/${id}/history${historyQs(opts)}`)

export const serverHistory = (id: string, opts?: HistoryOpts) =>
  apiFetch<ServerHistoryResponse>(`/servers/${id}/history${historyQs(opts)}`)

// --- 2FA -----------------------------------------------------------------

export interface TotpSetupResponse {
  secret: string
  provisioning_uri: string
  qr_svg: string
}

export const totpSetup = () =>
  apiFetch<TotpSetupResponse>("/auth/totp/setup", { method: "POST" })

export const totpEnable = (secret: string, code: string) =>
  apiFetch<{ recovery_codes: string[] }>("/auth/totp/enable", {
    method: "POST",
    body: JSON.stringify({ secret, code }),
  })

export const totpDisable = (code: string) =>
  apiFetch<{ status: string }>("/auth/totp/disable", {
    method: "POST",
    body: JSON.stringify({ code }),
  })

// --- account -------------------------------------------------------------

export const exportData = () => apiFetch<unknown>("/me/data-export")
export const deleteAccount = () =>
  apiFetch<{ status: string }>("/me/account", { method: "DELETE" })

// --- admin ---------------------------------------------------------------

export interface AdminUser {
  id: string
  email: string
  role: UserRole
  status: UserStatus
  totp_enabled: boolean
  created_at: string
  last_login_at: string | null
  device_count: number
}

export const adminListUsers = (q?: string, limit = 50, offset = 0) => {
  const params = new URLSearchParams()
  if (q) params.set("q", q)
  params.set("limit", String(limit))
  params.set("offset", String(offset))
  return apiFetch<{ total: number; items: AdminUser[] }>(
    `/admin/users?${params.toString()}`,
  )
}

// ── User detail (admin) ──────────────────────────────────────────────
// Bundles core user fields, quota state, the device list, and recent
// audit entries that target this user. One request hydrates the whole
// admin user-detail page.

export interface AdminUserDetail {
  id: string
  email: string
  role: UserRole
  status: UserStatus
  totp_enabled: boolean
  must_change_password: boolean
  created_at: string
  last_login_at: string | null
  email_verified_at: string | null
  password_changed_at: string
  current_month_bytes: number
  monthly_byte_cap: number | null
  quota_resets_at: string | null
  device_count: number
}

export interface AdminUserDevice {
  id: string
  name: string
  os: DeviceOs
  status: DeviceStatus
  allocated_ip: string
  dns_names: string[]
  last_handshake_at: string | null
  created_at: string
}

export interface AdminUserActivity {
  id: number
  action: string
  metadata: unknown
  created_at: string
}

export interface AdminUserDetailResponse {
  user: AdminUserDetail
  devices: AdminUserDevice[]
  activity: AdminUserActivity[]
}

export const adminGetUserDetail = (id: string) =>
  apiFetch<AdminUserDetailResponse>(`/admin/users/${id}`)

export interface AdminStats {
  total: number
  active: number
  suspended: number
  pending_verification: number
  devices_total: number
}
/** Deployment-wide user + device counts. Use this for the admin KPI
 *  strip rather than summing client-side over a paginated list. */
export const adminStats = () => apiFetch<AdminStats>("/admin/stats")

export interface AdminFleetBandwidth {
  rx_bytes: number
  tx_bytes: number
}
export const adminFleetBandwidth = () =>
  apiFetch<AdminFleetBandwidth>("/admin/bandwidth")

export const adminSetUserStatus = (id: string, status: UserStatus) =>
  apiFetch<{ status: string }>(`/admin/users/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  })

export const adminSetUserQuota = (id: string, monthly_byte_cap: number | null) =>
  apiFetch<{ status: string }>(`/admin/users/${id}/quota`, {
    method: "PUT",
    body: JSON.stringify({ monthly_byte_cap }),
  })

export interface AuditRow {
  id: number
  actor_user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  metadata: unknown
  created_at: string
}

export const adminListAudit = (limit = 100, offset = 0, action?: string) => {
  const params = new URLSearchParams()
  params.set("limit", String(limit))
  params.set("offset", String(offset))
  if (action) params.set("action", action)
  return apiFetch<{ total: number; items: AuditRow[] }>(
    `/admin/audit?${params.toString()}`,
  )
}

export const adminAuditCsvUrl = (limit = 5000) =>
  `/api/v1/admin/audit.csv?limit=${limit}`

export interface FailedLoginRow {
  id: number
  email_attempted: string | null
  reason: string
  attempted_at: string
}

export const adminListFailedLogins = (limit = 100, offset = 0) =>
  apiFetch<{ total: number; items: FailedLoginRow[] }>(
    `/admin/failed-logins?limit=${limit}&offset=${offset}`,
  )

export interface MaintenanceState {
  maintenance_mode: boolean
  maintenance_message: string | null
  updated_at: string
}

export const adminGetMaintenance = () =>
  apiFetch<MaintenanceState>("/admin/maintenance")

export const adminSetMaintenance = (
  maintenance_mode: boolean,
  maintenance_message?: string | null,
) =>
  apiFetch<{ status: string }>("/admin/maintenance", {
    method: "PUT",
    body: JSON.stringify({
      maintenance_mode,
      maintenance_message: maintenance_message ?? null,
    }),
  })

// ---------------------------------------------------------------------------
// Servers (admin)
// ---------------------------------------------------------------------------

export interface AdminServerRow {
  id: string
  name: string
  region: string
  endpoint_host: string
  endpoint_port: number
  public_key: string
  cidr: string
  dns_servers: string[]
  mtu: number
  is_active: boolean
}

export const adminListServers = () =>
  apiFetch<AdminServerRow[]>("/admin/servers")

export const adminPatchServer = (
  id: string,
  body: {
    endpoint_host?: string
    endpoint_port?: number
    mtu?: number
    dns_servers?: string[]
  },
) =>
  apiFetch<{ status: string }>(`/admin/servers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })

export const adminRotateServerKeys = (id: string) =>
  apiFetch<{
    status: string
    new_public_key: string
    wg0_conf_rewritten: boolean
    warning: string
  }>(`/admin/servers/${id}/rotate-keys`, { method: "POST" })

/** Admin-only: every non-revoked device across the fleet, each row
 *  carrying its owning `user_id`. Powers the admin topology view. */
export const adminListDevices = () =>
  apiFetch<PublicDevice[]>("/admin/devices")

export const adminImpersonateUser = (id: string) =>
  apiFetch<{ status: string }>(`/admin/users/${id}/impersonate`, {
    method: "POST",
  })

export const adminStopImpersonation = () =>
  apiFetch<{ status: string }>("/admin/impersonate/stop", { method: "POST" })
