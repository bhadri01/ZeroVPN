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
export type ApiTokenScope = "read" | "read_write" | "admin"
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
}

export interface LoginResponse {
  user: PublicUser
  must_change_password: boolean
  totp_required: boolean
}

export interface PublicDevice {
  id: string
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

export const verifyEmail = (token: string) =>
  apiFetch<{ status: string }>("/auth/verify-email", {
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
}) =>
  apiFetch<CreatedDevice>("/devices", {
    method: "POST",
    body: JSON.stringify(body),
  })

export const patchDevice = (
  id: string,
  body: {
    name?: string
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

export const setDeviceDns = (id: string, dns_names: string[]) =>
  apiFetch<{ dns_names: string[] }>(`/devices/${id}/dns`, {
    method: "PUT",
    body: JSON.stringify({ dns_names }),
  })

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

// --- API tokens ----------------------------------------------------------

export interface ApiTokenRow {
  id: string
  name: string
  scope: ApiTokenScope
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface CreatedApiToken {
  id: string
  name: string
  scope: ApiTokenScope
  plaintext_token: string
  created_at: string
  expires_at: string | null
}

export const listApiTokens = () => apiFetch<ApiTokenRow[]>("/api-tokens")

export const createApiToken = (body: {
  name: string
  scope?: ApiTokenScope
  expires_in_days?: number
}) =>
  apiFetch<CreatedApiToken>("/api-tokens", {
    method: "POST",
    body: JSON.stringify(body),
  })

export const revokeApiToken = (id: string) =>
  apiFetch<{ status: string }>(`/api-tokens/${id}`, { method: "DELETE" })

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
  return apiFetch<{ items: AuditRow[] }>(`/admin/audit?${params.toString()}`)
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
  apiFetch<{ items: FailedLoginRow[] }>(
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
// Webhooks (admin)
// ---------------------------------------------------------------------------

export type WebhookEventKind =
  | "peer_connected"
  | "peer_disconnected"
  | "device_paused"
  | "device_revoked"
  | "bandwidth_threshold"

export const ALL_WEBHOOK_EVENTS: WebhookEventKind[] = [
  "peer_connected",
  "peer_disconnected",
  "device_paused",
  "device_revoked",
  "bandwidth_threshold",
]

export interface WebhookRow {
  id: string
  name: string
  url: string
  events: WebhookEventKind[]
  active: boolean
  last_delivery_at: string | null
  last_status: number | null
  failure_count: number
  created_at: string
}

export const adminListWebhooks = () => apiFetch<WebhookRow[]>("/admin/webhooks")

export const adminCreateWebhook = (body: {
  name: string
  url: string
  events: WebhookEventKind[]
  secret?: string
}) =>
  apiFetch<{ id: string }>("/admin/webhooks", {
    method: "POST",
    body: JSON.stringify(body),
  })

export const adminDeleteWebhook = (id: string) =>
  apiFetch<{ status: string }>(`/admin/webhooks/${id}`, { method: "DELETE" })

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
