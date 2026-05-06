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

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  headers.set("Accept", "application/json")

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
  })

  if (!res.ok) {
    let body: ApiErrorBody = {}
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      // ignore; body is not json
    }
    throw new ApiError(
      res.status,
      body.error?.code ?? `http_${res.status}`,
      body.error?.message ?? res.statusText,
      body.error?.request_id,
    )
  }
  // 204 No Content
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

export interface PingResponse {
  pong: boolean
  ts_ms: number
}

export const ping = () => apiFetch<PingResponse>("/ping")
