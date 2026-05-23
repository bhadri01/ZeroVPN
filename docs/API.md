# ZeroVPN — Frontend API Reference

Self-hosted WireGuard VPN management API. This document describes every HTTP endpoint and the realtime WebSocket stream the frontend talks to, with request/response payload shapes.

> **Machine-readable source of truth:** the server publishes a live OpenAPI 3.1 spec at **`GET /openapi.json`**. It is generated from the handlers themselves, so it never drifts from the running code. You can generate a typed client with `npx openapi-typescript http://<host>/openapi.json -o src/api/types.ts`. This Markdown is the human-friendly companion.

---

## 1. Basics

| Thing | Value |
|---|---|
| Base URL (versioned) | `/api/v1` |
| Root URL (health/spec only) | `/` |
| Request body format | `application/json` (unless noted) |
| Response body format | `application/json` (unless noted: CSV, Prometheus text, WS binary) |
| Auth | Session **cookie** (`zerovpn_session`), set on login |
| Timestamps | RFC 3339 strings, e.g. `"2026-05-23T10:30:00Z"` |
| IDs | UUID strings |

Everything below the `/api/v1` prefix is what app code calls. The four root endpoints (`/health`, `/ready`, `/metrics`, `/openapi.json`) are **not** under `/api/v1`.

---

## 2. Authentication model

Auth is **cookie-session based**, not bearer tokens.

1. `POST /api/v1/auth/login` with email + password.
2. On success the server sets an **HttpOnly** cookie named `zerovpn_session` (`SameSite=Lax`, `Secure` in production over HTTPS).
3. Every subsequent request must send that cookie. With `fetch`, set **`credentials: "include"`**.
4. There is no CSRF token; the cookie is `SameSite=Lax`, so cross-site POSTs are blocked by the browser. Keep API calls same-site (or proxy through your own origin).

### Login gates

`POST /auth/login` can return **200** while *not* having established a session. Always inspect the body:

```json
{
  "user": { "id": "...", "email": "...", "role": "user", "totp_enabled": true,
            "is_impersonated": false },
  "must_change_password": false,
  "totp_required": false
}
```

- `totp_required: true` → password was correct but the account has 2FA and no/!valid `totp_code` was supplied. **No session was created.** Re-submit `POST /auth/login` with the `totp_code` field added.
- `must_change_password: true` → session *is* established, but route the user to a change-password screen before unlocking the dashboard. Call `POST /me/change-password`.

### Session lifetime

Idle window: 30 minutes (production) / 30 days (dev). Each authenticated request refreshes it. Sessions are also force-killed server-side on password change, password reset, "sign out everywhere", admin suspend/delete, and admin "revoke sessions" — after those, the next request returns `401`.

### Roles

`role` is `"admin"` or `"user"`. Admin-only endpoints (everything under `/admin/*`, plus `GET /servers/{id}/history`) return **403** for non-admins.

---

## 3. Conventions

### Error envelope

All 4xx/5xx errors (except maintenance mode) share this shape:

```json
{
  "error": {
    "code": "validation",
    "message": "human-readable detail",
    "request_id": "0190f3a2-..."
  }
}
```

| HTTP | `code` | Meaning |
|---|---|---|
| 401 | `unauthorized` | No/expired session, bad credentials |
| 403 | `forbidden` | Logged in but not allowed (e.g. not admin, suspended) |
| 403 | `email_not_verified` | Account is `pending_verification` |
| 404 | `not_found` | Missing or not owned by caller |
| 409 | `conflict` | Duplicate / cap hit / illegal state transition |
| 422 | `validation` | Bad request body or query params |
| 429 | `rate_limited` | Too many recent failed logins for the email |
| 500 | `internal` | Server error (the `request_id` is your correlation key) |
| 503 | `maintenance` | Maintenance mode on (see below) |

**Maintenance mode** is the one exception — it returns `503` with no `request_id`:

```json
{ "error": { "code": "maintenance", "message": "Service is in maintenance mode. Try again shortly." } }
```

When maintenance is on, **all writes** (POST/PUT/PATCH/DELETE) get `503` for non-admins; reads keep working so the UI still renders. Auth endpoints stay open so admins can log in.

### Pagination

List endpoints that paginate take `limit` + `offset` query params and return `{ "total": <int>, "items": [...] }`. `total` ignores `limit`/`offset` so you can build page controls.

### Shared enums

| Enum | Values |
|---|---|
| `UserRole` | `admin`, `user` |
| `UserStatus` | `active`, `suspended`, `pending_verification`, `deleted` |
| `DeviceStatus` | `active`, `paused`, `revoked` |
| `DeviceOs` | `ios`, `android`, `macos`, `windows`, `linux`, `other` |
| `FailedLoginReason` | `wrong_password`, `unknown_email`, `totp_failed`, `account_suspended`, `account_pending_verification`, `rate_limited` |
| `SessionEvent` | `login`, `logout`, `idle_timeout`, `suspicious_login`, `password_change`, `totp_enable`, `totp_disable`, `impersonation_start`, `impersonation_end` |

---

## 4. Health & infra (root, no `/api/v1`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | none | Liveness. `{ "status": "ok", "version": "x.y.z" }` |
| GET | `/ready` | none | Readiness (checks DB). `200 { "ready": true }` or `503 { "ready": false, "reason": "db" }` |
| GET | `/api/v1/ping` | none | Echo. `{ "pong": true, "ts_ms": 1716456600000 }` |
| GET | `/metrics` | none | Prometheus text exposition (not JSON) |
| GET | `/openapi.json` | none | OpenAPI 3.1 spec |

---

## 5. Auth

### `POST /api/v1/auth/register`
Register a new account. **Enumeration-safe** — always returns the same shape whether the email is new or taken. First-ever user becomes `admin`; everyone else is `user`. New accounts are `pending_verification`; a verify-email link is sent.

Request:
```json
{ "email": "user@example.com", "password": "min-12-chars" }
```
Response `200`: `{ "status": "ok" }`
Errors: `422` validation (bad email / password < 12 or > 128 chars).

### `POST /api/v1/auth/login`
Request:
```json
{ "email": "user@example.com", "password": "secret", "totp_code": "123456" }
```
`totp_code` is optional — required only when the account has 2FA. Accepts a 6-digit TOTP or an 8-char recovery code.

Response `200` — see [Login gates](#login-gates) for the shape and how to handle `totp_required` / `must_change_password`.

Errors: `401` bad credentials / wrong or missing TOTP / unknown email · `403` suspended · `403 email_not_verified` · `429` rate limited (≥5 failed attempts in 15 min for that email).

### `POST /api/v1/auth/logout`
Auth required. Flushes the session. Response `200`: `{ "status": "ok" }`.

### `GET /api/v1/me`
Auth required. The authenticated user.
```json
{
  "id": "uuid", "email": "user@example.com", "role": "user",
  "totp_enabled": false,
  "is_impersonated": false,
  "impersonator_email": null
}
```
`is_impersonated`/`impersonator_email` are set when an admin is impersonating this account. Errors: `401`.

### Email verification & password reset

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/verify-email` | none | `{ "token": "..." }` | `{ "status": "ok", "user": { "id", "email", "role", "totp_enabled" } }` — also establishes a session |
| POST | `/auth/resend-verify` | none | `{ "email": "..." }` | `{ "status": "ok" }` (enumeration-safe, rate-limited to 3 / 10 min) |
| POST | `/auth/forgot-password` | none | `{ "email": "..." }` | `{ "status": "ok" }` (enumeration-safe) |
| POST | `/auth/verify-reset-token` | none | `{ "token": "..." }` | `{ "valid": true }` or `{ "valid": false, "reason": "invalid" \| "used" \| "wrong_purpose" \| "expired" }` |
| POST | `/auth/reset-password` | none | `{ "token": "...", "new_password": "min-12" }` | `{ "status": "ok" }` — kills every existing session for that user |

Tokens arrive via emailed links: `/<base>/verify-email?token=...` (24 h TTL) and `/<base>/reset-password?token=...` (1 h TTL). Use `verify-reset-token` as a pre-flight so you can show an "expired link" state before the user types a new password.

### Two-factor (TOTP)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/totp/setup` | yes | — | `{ "secret": "BASE32", "provisioning_uri": "otpauth://...", "qr_svg": "<svg>..." }` |
| POST | `/auth/totp/enable` | yes | `{ "secret": "...", "code": "123456" }` | `{ "recovery_codes": ["...", ...] }` — **shown once** |
| POST | `/auth/totp/disable` | yes | `{ "code": "123456" }` | `{ "status": "ok" }` |

`setup` does not persist anything — call `enable` with the same `secret` and a working code to commit. `enable` returns recovery codes once; surface them and have the user save them. `disable` requires a current valid code so a stolen session alone can't turn 2FA off. `409` if already enabled (setup/enable) or not enabled (disable).

---

## 6. Account (`/me`)

All require a session.

### `GET /me/server`
WG server defaults for the create-device dialog (no secrets).
```json
{ "cidr": "10.10.0.0/22", "dns_servers": ["10.10.0.1"],
  "endpoint_host": "vpn.example.com", "endpoint_port": 51820, "mtu": 1420 }
```
`404` if no active server exists.

### `GET /me/preferences` · `PUT /me/preferences`
Server-synced UI preferences. `GET` returns defaults if never saved. `PUT` is a partial patch (send only changed fields); the server returns the **full merged** state.

Full shape (also the GET response):
```json
{
  "units": "bps",                 // "bps" | "Bps"
  "date_format": "iso",           // "iso" | "us" | "eu"
  "time_format": "h24",           // "h24" | "h12"
  "reduced_motion": false,
  "default_landing": "dashboard", // "dashboard" | "devices" | "topology"
  "toast_position": "bottom-right", // top/bottom-left/center/right
  "toast_sound": false,
  "browser_notifications": false,
  "email_on_new_device": true,
  "email_on_quota_warning": true,
  "email_on_security_event": true
}
```
`422` on an unknown enum value. (Theme/accent are intentionally **not** here — keep those in `localStorage` to avoid a flash on first paint.)

### `GET /me/topology` · `PUT /me/topology`
Saved node positions for the live-topology drag UI. Flat `{ node_id: {x, y} }` map.
```json
{ "positions": { "<device-uuid>": { "x": 120.5, "y": 80 }, "__hub__": { "x": 0, "y": 0 } } }
```
`PUT` body is the same shape; response: `{ "status": "ok", "count": <rows persisted> }`. Non-finite coords and ids longer than 64 chars are silently dropped; max 1024 entries (else `422`).

### `POST /me/change-password`
```json
{ "current_password": "...", "new_password": "min-12-different" }
```
Response `200`: `{ "status": "ok" }`. Rotates the password; **this** session stays alive, every other session for the user dies on its next request. `422` if current is wrong / new == current / new too short.

### `POST /me/sessions/revoke-all`
"Sign out everywhere." No body. `{ "status": "ok" }`. Invalidates every *other* session; keeps the caller signed in. No password change.

### `GET /me/data-export`
GDPR export — JSON blob of the user row, all their devices, and audit entries they authored (no password/TOTP material).
```json
{ "generated_at": "RFC3339", "user": {...}, "devices": [...], "audit": [...] }
```

### `DELETE /me/account`
Soft-delete: nulls PII, revokes devices, releases IPs, flushes session. `{ "status": "ok" }`.

---

## 7. Devices

All require a session. Per-user cap is **5** active devices.

### Core object — `PublicDevice`
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "My Laptop",
  "os": "macos",
  "public_key": "base64-wg-pubkey",
  "allocated_ip": "10.10.0.5",
  "status": "active",
  "server_id": "uuid",
  "dns_names": ["laptop.alice.vpn.local"],
  "allowed_ips_override": ["10.10.0.0/22"],   // null unless split-tunnel
  "dns_override": ["1.1.1.1"],                // null unless custom DNS
  "last_handshake_at": "RFC3339 | null",
  "created_at": "RFC3339",
  "private_key_stored": false
}
```
Note `allocated_ip` is a bare address (no `/32`). The WG private key is **never** returned here; `private_key_stored` only tells you whether the server kept an encrypted copy for later `.conf` re-download.

### `GET /devices`
List the caller's devices in display order → `PublicDevice[]`.

### `GET /devices/{id}`
One device → `PublicDevice`. `404` if missing/not owned.

### `POST /devices`
Create a device. The server generates the keypair; the **private key is shown only in this response** (and in rotate/redownload). Returns `201`.

Request (`name` required, rest optional):
```json
{
  "name": "My Laptop",
  "os": "macos",
  "split_tunnel": false,
  "dns_override": ["1.1.1.1", "1.0.0.1"],
  "allocated_ip": "10.10.0.42",
  "store_private_key": false
}
```
- `split_tunnel: true` → only VPN-subnet traffic routes through the tunnel (AllowedIPs restricted).
- `allocated_ip` → request a specific IP; omit to auto-assign next free.
- `store_private_key: true` → server keeps a KEK-encrypted copy so the user can re-download the `.conf` later. Default is zero-knowledge (key vanishes after this response).

Response `201` — `CreatedDevice`:
```json
{
  "device": { /* PublicDevice */ },
  "config": "[Interface]\nPrivateKey = ...\n...",  // full WG .conf text
  "qr_svg": "<svg>...</svg>"                         // scannable QR of the .conf
}
```
Errors: `422` validation / bad IP / outside subnet / reserved IP · `409` device cap hit or chosen IP already taken / pool exhausted.

### `PATCH /devices/{id}`
Partial update. Any field optional; send only what changes.
```json
{ "name": "Renamed", "os": "linux",
  "allowed_ips_override": ["10.10.0.0/22"], "dns_override": ["9.9.9.9"] }
```
Response: `{ "status": "ok" }`. `422` bad CIDR/IP · `404`.

### `DELETE /devices/{id}`
Revoke the device + release its IP. `{ "status": "ok" }`. `404`.

### `POST /devices/{id}/pause` · `POST /devices/{id}/unpause`
Disable/enable the peer on the live WG interface. No body.
Responses: `{ "status": "paused" }` / `{ "status": "active" }`. `404` · `409` if revoked.

### `POST /devices/{id}/rotate-keys`
Generate a fresh keypair and return a new `.conf` + QR (same `CreatedDevice` shape as create). Optional body:
```json
{ "store_private_key": true }
```
(omit → inherit the device's current storage setting). `404` · `409` if revoked.

### `GET /devices/{id}/conf`
Re-render the `.conf` + QR from the server-stored private key. Returns `CreatedDevice`. `409` if the device wasn't created with `store_private_key` (no key to recover) or is revoked.

### `DELETE /devices/{id}/stored-key`
Stop storing the encrypted private key (device keeps working; only re-download is lost). Idempotent → `{ "status": "ok", "private_key_stored": false }`.

### `PUT /devices/order`
Persist device display order. Send full ordered id list.
```json
{ "ids": ["uuid1", "uuid2", "uuid3"] }
```
Response: `{ "status": "ok", "updated": <rows> }`. Ids not owned by the caller are silently ignored; max 500 ids (else `422`).

### DNS

| Method | Path | Body | Response |
|---|---|---|---|
| PUT | `/devices/{id}/dns` | `{ "dns_names": ["laptop.alice.vpn.local"] }` | `{ "dns_names": [...] }` |
| GET | `/devices/dns-check?name=<n>` | — | `{ "valid": true, "available": true }` or `{ "valid": ..., "available": false, "reason": "invalid" \| "taken" }` |

Max 4 DNS names per device. Names are unique across the deployment. `dns-check` is a cheap pre-flight for the create dialog (debounce it). PUT errors: `422` invalid hostname / too many · `404` · `409` name in use.

### `GET /devices/{id}/events`
Audit timeline for the device (newest first). Query: `limit` (default 100, clamped 1–500).
```json
[ { "id": 123, "action": "device.created", "metadata": {...}, "created_at": "RFC3339" } ]
```

---

## 8. Bandwidth

### `GET /devices/{id}/bandwidth?range=24h` · `GET /bandwidth?range=24h`
Per-device and per-user (aggregate) bucketed history. `range` ∈ `24h` | `7d` | `30d` (default `24h`). Buckets are hourly for 24h/7d, daily for 30d.
```json
{
  "bucket": "hour",            // "hour" | "day"
  "range": "24h",
  "buckets": [
    { "bucket_start": "RFC3339", "rx_bytes": 12345, "tx_bytes": 67890 }
  ]
}
```
`422` invalid range. Per-device requires ownership (`404` otherwise).

### `GET /devices/{id}/history?from=&to=&limit=`
Raw per-tick samples (high-resolution chart). `from`/`to` are RFC3339 (default: last hour); `limit` capped at 10000.
```json
{
  "device_id": "uuid", "from": "RFC3339", "to": "RFC3339",
  "samples": [ { "sampled_at": "RFC3339", "rx_bytes": 1, "tx_bytes": 2 } ]
}
```
> Bound your window — ~86k rows/day at 1 Hz.

### `GET /servers/{id}/history?from=&to=&limit=` — **admin only**
Per-server aggregate raw samples.
```json
{
  "server_id": "uuid", "from": "RFC3339", "to": "RFC3339",
  "samples": [ { "sampled_at": "RFC3339", "total_rx_bytes": 1, "total_tx_bytes": 2,
                 "peer_count": 10, "online_count": 4, "handshake_count": 3 } ]
}
```

---

## 9. Admin (`/admin/*`) — admin role required

All return `403` for non-admins. Listed compactly; request bodies and notable response shapes shown where they matter.

### Overview

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/stats` | `{ total, active, suspended, pending_verification, devices_total }` |
| GET | `/admin/bandwidth` | Fleet all-time totals `{ rx_bytes, tx_bytes }` |

### Users

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/users` | Paginated list. Query: `q` (email substring), `limit` (def 50, ≤200), `offset`, `status`, `role`, `totp_enabled`. Returns `{ total, items: AdminUser[] }` |
| GET | `/admin/users.csv` | Same filters; CSV download |
| POST | `/admin/users` | Create/invite a user (see below) |
| GET | `/admin/users/{id}` | Bundled detail (see below) |
| DELETE | `/admin/users/{id}` | Soft-delete. `422` self / last admin |
| PUT | `/admin/users/{id}/status` | `{ "status": "active" \| "suspended" \| ... }`. `422` if changing your own |
| PUT | `/admin/users/{id}/role` | `{ "role": "admin" \| "user" }`. `422` self / last admin |
| PUT | `/admin/users/{id}/email` | `{ "email": "..." }`. `422` bad/taken/deleted |
| PUT | `/admin/users/{id}/quota` | `{ "monthly_byte_cap": 1073741824 }` (null/0 = unlimited) |
| POST | `/admin/users/{id}/reset-password` | Email a reset link |
| POST | `/admin/users/{id}/disable-2fa` | Clear TOTP + recovery codes |
| POST | `/admin/users/{id}/sessions/revoke-all` | Force-logout the user |
| GET | `/admin/users/{id}/bandwidth?range=` | Bucketed aggregate (same shape as §8) |
| POST | `/admin/users/{id}/impersonate` | Begin impersonation → `{ "status": "ok" }` |
| POST | `/admin/impersonate/stop` | End impersonation (no admin role needed; the active session is the impersonated user) |

`AdminUser` (list row):
```json
{ "id": "uuid", "email": "...", "role": "user", "status": "active",
  "totp_enabled": false, "created_at": "RFC3339",
  "last_login_at": "RFC3339 | null", "device_count": 3 }
```

`POST /admin/users` request:
```json
{
  "email": "new@example.com",
  "password": null,               // omit → server generates a 24-char one
  "role": "user",
  "skip_verification": false,     // true → active immediately, email pre-verified
  "email_setup_link": true        // true → email a reset link instead of returning the password
}
```
Response:
```json
{ "id": "uuid", "email": "...", "role": "user", "status": "pending_verification",
  "generated_password": "shown-once-or-null" }
```
`generated_password` is present only when the server generated one **and** `email_setup_link` was false.

`GET /admin/users/{id}` returns a bundle:
```json
{
  "user": { /* AdminUserDetail: core + quota fields:
     current_month_bytes, monthly_byte_cap, quota_resets_at,
     must_change_password, email_verified_at, password_changed_at, ... */ },
  "devices": [ /* AdminUserDevice: id, name, os, status, allocated_ip,
     dns_names, last_handshake_at, last_peer_endpoint, last_peer_endpoint_at, created_at */ ],
  "activity": [ /* audit rows where user is actor OR target; ≤100 */ ],
  "session_events": [ /* SessionEventRow; ≤50 */ ],
  "connection_sessions": [ /* ConnectionSessionRow; ≤50 */ ]
}
```

### Devices (fleet)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/devices` | Every non-revoked device (all users), as `PublicDevice[]` — drives fleet topology |
| GET | `/admin/devices/{id}` | Bundle: `{ device, owner, activity[≤50] }` (device includes `last_peer_endpoint`) |
| GET | `/admin/devices/{id}/bandwidth?range=` | Bucketed (same shape as §8) |
| GET | `/admin/devices/{id}/endpoint-history` | `EndpointRow[]` — distinct `host:port` observed, newest first |
| GET | `/admin/devices/{id}/connection-history` | `ConnectionSessionRow[]` |

`ConnectionSessionRow`:
```json
{ "id": 1, "device_id": "uuid", "user_id": "uuid",
  "started_at": "RFC3339", "ended_at": "RFC3339 | null",
  "peer_endpoint_at_start": "1.2.3.4:51820", "peer_endpoint_at_end": "...",
  "rx_bytes_at_start": 0, "tx_bytes_at_start": 0,
  "rx_bytes_at_end": 123, "tx_bytes_at_end": 456 }
```
`EndpointRow`: `{ "id": 1, "endpoint": "1.2.3.4:51820", "observed_at": "RFC3339" }`. `ended_at: null` = still online.

### Servers

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/servers` | `AdminServer[]` |
| GET | `/admin/servers/{id}` | `{ server, device_count_active, device_count_paused, device_count_total, devices[] }` |
| PATCH | `/admin/servers/{id}` | `{ endpoint_host?, endpoint_port?, mtu?, dns_servers? }` (port 1–65535, mtu 576–9000) |
| GET | `/admin/servers/{id}/bandwidth?range=` | Bucketed (same shape as §8) |
| POST | `/admin/servers/{id}/rotate-keys` | Rotate server keypair (see below) |

`AdminServer`:
```json
{ "id": "uuid", "name": "default", "region": "local",
  "endpoint_host": "vpn.example.com", "endpoint_port": 51820,
  "public_key": "base64", "cidr": "10.10.0.0/22",
  "dns_servers": ["10.10.0.1"], "mtu": 1420, "is_active": true }
```
`rotate-keys` response:
```json
{ "status": "ok", "new_public_key": "base64", "wg0_conf_rewritten": true,
  "warning": "All peer .conf files reference the OLD server pubkey and must be re-downloaded. Restart the wg container ..." }
```

### Audit & security logs

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/audit` | `{ total, items: AuditRow[] }`. Query: `limit` (≤500), `offset`, `action`, `actor_user_id`, `target_id`, `target_type`, `since`, `until` |
| GET | `/admin/audit.csv` | Same filters; CSV |
| GET | `/admin/failed-logins` | `{ total, items: FailedLoginRow[] }` |
| GET | `/admin/session-events` | `{ total, items: SessionEventRow[] }`. Query: `limit`, `offset`, `user_id`, `event`, `ip`, `since`, `until` |
| GET | `/admin/access-logs` | `{ total, items: AccessLogRow[] }`. Query adds `method`, `path` (prefix), `status_min`, `status_max`, `ip` |
| GET | `/admin/finder?q=` | Cross-source search (see below) |

`AuditRow`:
```json
{ "id": 1, "actor_user_id": "uuid | null", "action": "device.created",
  "target_type": "device | user | server | system | null", "target_id": "uuid | null",
  "metadata": {}, "ip": "203.0.113.42/32 | null", "user_agent": "string | null",
  "created_at": "RFC3339" }
```
`FailedLoginRow`: `{ id, email_attempted, reason (FailedLoginReason), ip, user_agent, attempted_at }`.
`SessionEventRow`: `{ id, user_id, event (SessionEvent), ip, user_agent, metadata, created_at }`.
`AccessLogRow`: `{ id, created_at, user_id, method, path, status, latency_ms, ip, user_agent, request_id }`.

> `ip` fields serialize as a network string like `"203.0.113.42/32"`. Strip the suffix for display.

`GET /admin/finder?q=` detects the query shape and returns click-through counts:
```json
{
  "query": "203.0.113.42",
  "kind": "ip",   // "ip" | "endpoint" | "regex" | "text"
  "counts": { "audit_logs": 3, "failed_logins": 1, "session_events": 0,
              "access_logs": 12, "peer_endpoint_history": 2, "connection_sessions": 1 },
  "users":   [ { "id": "uuid", "email": "...", "matched_on": "email | last_login_ip" } ],
  "devices": [ { "id": "uuid", "user_id": "uuid", "name": "...", "allocated_ip": "10.10.0.5",
                 "last_peer_endpoint": "1.2.3.4:51820",
                 "matched_on": "name | allocated_ip | last_peer_endpoint" } ]
}
```
A `/pattern/` query is treated as a POSIX regex (max 200 chars; `422` on invalid regex).

### Maintenance mode

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/maintenance` | `{ maintenance_mode, maintenance_message, updated_at }` |
| PUT | `/admin/maintenance` | `{ "maintenance_mode": true, "maintenance_message": "back at 5pm" }` → `{ "status": "ok" }` |

---

## 10. Realtime — WebSocket

### `GET /api/v1/ws`
Auth required (session cookie). Upgrades to a WebSocket and streams live events.

**Frames are binary MessagePack, not JSON.** They use the shared `zerovpn-wire` schema, which is also compiled to WASM — decode with `decode_frame(bytes)` from the wire package, or any MessagePack decoder (struct fields are encoded by name; UUIDs/IPs as strings).

Connect with the session cookie present (the browser sends it automatically on same-origin WS). Send nothing; the server ignores inbound data but answers WS pings. The server may drop frames for a lagging client (buffer is 64) — live stats are recoverable on next poll, so treat the stream as best-effort.

### Visibility filtering
- **Regular users** receive only events scoped to their own `user_id`, plus `server_health`.
- **Admins** receive everything.
- `heartbeat` and `server_sample` are admin-only.

### Event variants
Each event is a tagged object: `{ "type": "<snake_case>", ...fields }`.

| `type` | Fields |
|---|---|
| `heartbeat` | `ts_ms` |
| `stats_delta` | `device_id`, `user_id`, `rx_bytes`, `tx_bytes`, `rate_rx_bps`, `rate_tx_bps`, `ts_ms` |
| `handshake_change` | `device_id`, `user_id`, `last_handshake_ms` |
| `peer_status_changed` | `device_id`, `user_id`, `status` (`active`/`paused`/`revoked`) |
| `dns_updated` | `device_id`, `user_id`, `dns_names[]` |
| `server_health` | `server_id`, `cpu_pct`, `mem_used_bytes`, `mem_total_bytes`, `active_peers`, `disk_read_bps`, `disk_write_bps`, `net_rx_bps`, `net_tx_bps`, `uptime_sec`, `ts_ms` |
| `server_sample` | `server_id`, `total_rx_bytes`, `total_tx_bytes`, `rate_rx_bps`, `rate_tx_bps`, `peer_count`, `online_count`, `handshake_count`, `ts_ms` |

Example decoded `stats_delta`:
```json
{ "type": "stats_delta", "device_id": "uuid", "user_id": "uuid",
  "rx_bytes": 1024, "tx_bytes": 2048, "rate_rx_bps": 800, "rate_tx_bps": 1600,
  "ts_ms": 1716456600000 }
```

---

## 11. Quick integration notes

- Always `fetch(..., { credentials: "include" })` so the session cookie rides along.
- After login, branch on `totp_required` then `must_change_password` before navigating to the dashboard.
- The `.conf` text and recovery codes are returned **once** — render them immediately and warn the user.
- Poll-free UI: open the WS for live bandwidth/handshake/health; use the REST bandwidth endpoints for historical charts.
- `ip` strings carry a `/32` or `/128` suffix — trim for display.
- For end-to-end type safety, generate types from `/openapi.json` rather than hand-typing these shapes.
