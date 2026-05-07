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
}

export interface PublicDevice {
  id: string
  name: string
  os: DeviceOs
  public_key: string
  allocated_ip: string
  status: DeviceStatus
  dns_names: string[]
  allowed_ips_override: string[] | null
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

export const login = (body: { email: string; password: string }) =>
  apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  })

export const logout = () =>
  apiFetch<{ status: string }>("/auth/logout", { method: "POST" })

export const me = () => apiFetch<PublicUser>("/me")

export const listDevices = () => apiFetch<PublicDevice[]>("/devices")

export const getDevice = (id: string) => apiFetch<PublicDevice>(`/devices/${id}`)

export const createDevice = (body: { name: string; os?: DeviceOs }) =>
  apiFetch<CreatedDevice>("/devices", {
    method: "POST",
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
