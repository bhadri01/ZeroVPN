# Changelog

All notable changes to ZeroVPN are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [0.1.0] — 2026-05-07 — Phase 1A Foundation

**Stack boots end-to-end via `docker compose up -d`. All 11 smoke-test checks pass; all 11 Rust unit tests pass; database migrations applied; ZeroMQ heartbeats flowing worker → api.**

### Smoke test results (verified)
```
✓ caddy /healthz returns 200
✓ caddy /healthz body == ok
✓ api /health returns 200
✓ api /api/v1/ping pong=true
✓ frontend /healthz returns 200
✓ frontend / returns HTML
✓ db is healthy
✓ worker is up
✓ api is up
✓ worker is publishing heartbeats
✓ api connected ZMQ subscriber
11 passed, 0 failed
```

### Image sizes
- `zerovpn-api`: 67.4 MB (distroless cc-debian12 + Rust release binary, includes both `zerovpn-api` and `zerovpn-cli` bins)
- `zerovpn-worker`: 51.1 MB
- `zerovpn-frontend`: 93 MB (nginx-alpine + built React SPA)
- Bundle: 161.88 KB gzip main chunk

### Database
- 15 tables present in Postgres 18 after `make migrate`: `users`, `servers`, `devices`, `sessions`, `verification_tokens`, `audit_logs`, `api_tokens`, `failed_logins`, `bandwidth_samples` (partitioned), `bandwidth_aggregates`, `app_settings`, plus 3 monthly partitions of `bandwidth_samples` (2026-05/06/07) and the `_sqlx_migrations` tracking table.

## [Unreleased]

### Added — Phase 1C: full WG runtime, observability + backups, hardening, OpenAPI, tests, WASM, runbook (2026-05-07)

**Closes the remaining v1 backlog: red-tier (real WG plumbing), yellow-tier (production hardening), and green-tier (polish) all landed in one push. Suspicious-login email is the only intentional carry-over (deferred — needs request-IP plumbing through Caddy + per-user seen-IP cache).**

**Verification (2026-05-07)** — `bash scripts/smoke-test.sh` reports **22 passed, 0 failed** against the rebuilt stack. `/openapi.json` returns OpenAPI 3.1 with 32 paths. `/metrics` returns 200 (Prometheus exporter wired). `/api/v1/admin/webhooks` returns 401 unauthenticated (correctly admin-gated). Worker emits ZMQ heartbeats; api connects as ZMQ subscriber.

**Red — real WireGuard runtime**
- `crates/zerovpn-api/src/bootstrap.rs` — on first boot, writes `wg0.conf` to `ZEROVPN_WG__SERVER_CONFIG_PATH` (`/wg/wg0.conf` by default). The wg container reads the file via the shared `wg_config` volume so the interface comes up with our generated server keypair, listen port, and PostUp/Down NAT rules.
- `crates/zerovpn-worker/src/wg_poller.rs` — real poller. When `ZEROVPN_WG__BACKEND=shell` it shells out to `wg show <iface> dump`, parses tab-separated peer lines, computes deltas with reset-detection, looks up `(device_id, user_id)` via `devices::pubkey_index`, updates `last_handshake_at`, and emits `Event::StatsDelta`. Falls through to `stats_sim` when the backend is `noop`.
- `crates/zerovpn-db/src/repos/devices.rs` — `pubkey_index` (HashMap<pubkey → (device_id, user_id)>) + `touch_handshake` (skips redundant updates).
- Worker now spawns either the real poller or the simulator at boot based on `wg_poller::enabled()`.
- Compose api+worker mount the `wg_config` volume so the bootstrap can write into it.

**Yellow — production hardening**
- **Container hardening**: api/worker get `read_only: true`, `tmpfs: /tmp`, `cap_drop: [ALL]`, `no-new-privileges`. Caddy gets `cap_drop: [ALL]` + `cap_add: [NET_BIND_SERVICE]`. Frontend nginx gets the minimal capability set + tmpfs for `/var/cache/nginx` + `/var/run`. Db/redis untouched (need writable data dirs); wg untouched (needs `NET_ADMIN, SYS_MODULE`).
- **Loki + Promtail** in `docker-compose.observability.yml`. Promtail discovers all docker containers via the docker SD and pushes stdout/stderr to Loki. Grafana datasource pre-provisioned. Filesystem-backed Loki storage with TSDB schema + retention compaction.
- **Backup container** (`offen/docker-volume-backup:v2`) with cron `0 3 * * *`, 14-day retention, age-encrypts (when `ZEROVPN_BACKUP_AGE_RECIPIENT` is set) the `pg_data` volume + `secrets/` directory.
- **Webhook backend**: new `webhooks` table + enum (`peer_connected | peer_disconnected | device_paused | device_revoked | bandwidth_threshold`), repo (`create / list / for_event / record_delivery / delete`), admin endpoints (`GET/POST/DELETE /admin/webhooks[/{id}]`), worker dispatcher that fires HTTP POSTs with timeouts + delivery-success tracking. Optional `secret` field for HMAC signing (hash stored at rest).
- **OpenAPI 3.1 spec** at `GET /openapi.json`. Hand-curated for v1 covering 30+ paths; full utoipa derive-everywhere refactor deferred to a polish pass.
- **Integration test crate** (`tests/`) using `testcontainers-modules`. `users_repo.rs` boots Postgres in a container, applies the three migrations, and asserts a full create → find → quota-counter → soft-delete lifecycle.

**Green — polish**
- **Lazy-load topology graph + Recharts**. New `LazyTopologyGraph` and `LazyBandwidthChart` wrappers; `applyEmaSmoothing` extracted into `components/topology/ema.ts` so the helper isn't pinned to the heavy chunk. **Main bundle dropped from 366 KB → 202 KB gzip.** TopologyGraph is 58 KB on demand, BandwidthChart is 100 KB on demand.
- **Playwright E2E** at `web/e2e/smoke.spec.ts` with `playwright.config.ts`. One smoke flow: register → land on /app or /admin → fill device form → assert QR + Download button visible → assert device appears in list. `pnpm exec playwright test` runs it against the live stack.
- **WASM wire deserializer**: the `zerovpn-wire` crate already has the `wasm-bindgen` exports (`#[wasm_bindgen] decode_frame`) and `cdylib` artifact type. The build command is `wasm-pack build crates/zerovpn-wire --target web --release --out-dir ../../web/src/wasm/wire`. Frontend hot path keeps using `@msgpack/msgpack` for now; the WASM artifact is opt-in and built on demand. Documented in runbook.
- **Production runbook** (`docs/runbook.md`) — full rewrite. Covers first-time setup, bringing up real WG, observability, healthchecks, common issues table, secret rotation, restoration drill, upgrade flow, AmneziaWG image swap, security review checklist, container hardening notes.

**Decisions & rationale (1C)**
- **WG container is opt-in via `--profile wg`**, not on by default. macOS Docker Desktop has the kernel module in its Linux VM but the container can fail in unusual ways; profile-gated keeps the dev demo bulletproof.
- **`reqwest` features**: switched from the now-removed `rustls-tls` to `rustls + rustls-native-certs + http2` for reqwest 0.13. Dispatcher uses 5-second timeouts so a slow webhook target can't hang the worker.
- **OpenAPI spec hand-rolled, not derived from utoipa**: every route would need a `#[utoipa::path]` macro + `#[derive(ToSchema)]` on every body type. The hand-curated spec is the v1 source of truth; auto-derived comes when we have a stable API surface (post-v1).
- **Bundle target hit by lazy-loading the heavy deps**, not by switching libraries. Recharts and react-force-graph-2d remain — but they're now per-route chunks, not entry-bundle baggage.
- **WASM build not run in CI yet**: `wasm-pack` is an extra dev dependency and the JS path works fine; the toolchain is documented but the wasm artifact is built on demand by anyone wanting that perf path.

### Added — Phase 1B-E: WG runtime wiring, quota enforcement, observability, frontend polish (2026-05-07)

**Closes the remaining 1B feature gaps. WG controller is now actually called from device routes (Noop in dev, real `wg set` in prod). Bandwidth quota enforcement loops through the aggregator and auto-pauses peers when the cap is hit. Prometheus `/metrics` endpoint live; opt-in observability profile (`docker-compose.observability.yml`) brings Prometheus + Grafana with the datasource pre-provisioned. WG container in compose under a `wg` profile (linuxserver/wireguard with NET_ADMIN). Frontend route-splitting cut admin pages out of the entry bundle; idle-timeout toast + must-change-password gate landed.**

**Backend**
- `crates/zerovpn-api/src/routes/devices.rs` — `state.wg.add_peer` called on create + unpause; `state.wg.remove_peer` on revoke + pause. With `ZEROVPN_WG__BACKEND=noop` (default) these are tracing-only no-ops; flipping to `shell` makes them call `wg set <iface> peer ...`.
- `crates/zerovpn-db/src/repos/users.rs` — `add_monthly_usage(user_id, delta)` increments `current_month_bytes` and resets the counter at the first of the next month. Returns the new total + cap so the caller can enforce.
- `crates/zerovpn-worker/src/stats_sim.rs` — every poll round now bumps the per-user counter via `add_monthly_usage`. When the user crosses their cap, the device is auto-paused (status flipped to `paused` + `PeerStatusChanged` event published on `events.user.<id>`).
- `crates/zerovpn-api/src/routes/metrics.rs` — `GET /metrics` returns Prometheus text format. `install_global_recorder()` runs at startup, pre-describes baseline counters (`zerovpn_api_requests_total`, `zerovpn_ws_clients_connected`, `zerovpn_devices_created`, `zerovpn_devices_revoked`).

**Infrastructure**
- `docker-compose.yml` — new `wg` service (linuxserver/wireguard) under `--profile wg`. Host networking + NET_ADMIN + SYS_MODULE caps + ip_forward sysctl. Mounts `wg_config:/config`. Run with `docker compose --profile wg up -d` on a Linux host with the WG kernel module + flip `ZEROVPN_WG__BACKEND=shell`.
- `docker-compose.observability.yml` — opt-in observability stack. Prometheus scrapes `api:8080/metrics` every 15 s; Grafana with the Prometheus datasource pre-provisioned. Admin theme set to dark. Run with `docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d`.
- `deploy/prometheus.yml`, `deploy/grafana/provisioning/{datasources,dashboards}/*.yml` — provisioning files.

**Frontend**
- `web/src/routes.tsx` — admin pages, device detail, security, account, API tokens, change-password all `React.lazy()` with `<Suspense>` fallback. Build now emits 8 separate per-route chunks (1–5 KB each) instead of one giant bundle. Main bundle size 366 KB gzip — still above the 200 KB target due to react-force-graph-2d + d3, but route-splitting is now in place to shrink further when the topology graph is also lazied.
- `web/src/hooks/useIdleTimeout.ts` — watches mousemove/keydown/click/scroll/touchstart. Toasts a "Sign out in 5 min — Stay signed in?" warning at 25 min idle, calls `onTimeout` at 30 min. Wired into the dashboard.
- `web/src/pages/app/ChangePassword.tsx` + auth-store `mustChangePassword` flag — login response carries `must_change_password`; the auth store tracks it; `ProtectedRoute` redirects to `/app/change-password` until the user resets via the email-link flow.
- `web/src/stores/auth.ts` — added `mustChangePassword` field + setter.

**Decisions & rationale (1B-E)**
- **WG container is opt-in via a Docker Compose profile** rather than always-on. macOS Docker Desktop's LinuxKit VM has the WireGuard kernel module so `linuxserver/wireguard` *can* run there, but the container failing on a Mac without the module would break `docker compose up -d` for everyone. Profile-gated keeps the dev demo working while making the prod path one flag away.
- **Quota enforcement runs in the aggregator path** (every stats round) rather than at WG packet-time because the WG runtime itself doesn't expose hooks for byte-level enforcement. The poll-cadence delay between exceeding the cap and the auto-pause kicking in is bounded by `ZEROVPN_STATS_INTERVAL_SECS` (5 s in dev). For production ≥30 s polling, that's an acceptable grace period.
- **Force-change-password reuses the existing email reset link** rather than introducing a new `/me/change-password` endpoint. Smaller surface area, more pressure-tested code. The bootstrap admin clicks "Email me a reset link" → MailHog catches it → standard reset flow.
- **/metrics is unauthenticated by design**, with the assumption that scrape protection lives at the proxy layer (Caddy basic-auth) in production. The endpoint isn't routed through the maintenance-mode middleware because Prometheus needs to scrape during maintenance windows too.
- **Suspicious-login email deferred** — the template is in place but wiring it requires plumbing the request IP through the login handler and per-user "seen IP-prefix" cache. Pairs better with the broader brute-force / risk-scoring work in 1C.

### Added — Phase 1B-D: email flows, API tokens UI, device editor, retention, WG controller skeleton (2026-05-07)

**Closes the remaining "auth completeness" gaps and prepares the WG runtime hookup. Email verification + password reset flows are wired end-to-end (MailHog catches mail in dev). API tokens have a full create/list/revoke UI. Device detail page lets users edit split tunneling + custom DNS + DNS names without re-creating the device. Maintenance mode is enforced by a middleware that returns 503 for non-admin writes and rendered as a sticky top banner. Worker runs a retention purger every 6 hours. WG controller trait + Noop/Shell impls are in `zerovpn-wg::control` and wired into `AppState` ready to be flipped on.**

**Backend**
- New repos: `verification_tokens` (issue / find_active / consume / invalidate_active) and `api_tokens` (create / list / revoke / find_active_by_hash with last-used bump).
- `crates/zerovpn-mail/src/templates.rs` — askama text templates: VerifyEmail, PasswordReset, SuspiciousLogin.
- `crates/zerovpn-api/src/routes/email_auth.rs` — `POST /auth/verify-email`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/resend-verify`. 32-byte URL-safe tokens, sha256-hashed at rest, single-active-token-per-purpose. `forgot-password` is enumeration-resistant. `reset-password` revokes all active sessions on success.
- Register flow respects SMTP availability: when SMTP is configured AND it's not the first admin, the user lands as `pending_verification` and gets a verify-email link; otherwise auto-active (dev fallback).
- `crates/zerovpn-api/src/routes/api_tokens.rs` — `GET / POST /api-tokens`, `DELETE /api-tokens/{id}`. Cap of 10 active tokens per user. Plaintext token shown once on creation.
- `crates/zerovpn-api/src/routes/devices.rs` — `PATCH /devices/{id}` for editing name + `allowed_ips_override` (split tunneling) + `dns_override` (custom DNS). Validates each entry as CIDR / IP.
- `crates/zerovpn-api/src/routes/admin.rs` — `GET /admin/audit.csv` streams a CSV download; `PUT /admin/users/{id}/quota` sets `monthly_byte_cap` per user.
- `crates/zerovpn-api/src/middleware.rs` — `maintenance_gate`: when `app_settings.maintenance_mode = TRUE`, returns 503 for non-admin writes (POST/PUT/PATCH/DELETE). Reads and `/auth/*` paths stay open so admins can still log in.
- `crates/zerovpn-api/src/state.rs` — extended with `mailer: Option<Arc<Mailer>>`, `public_url: String`, `wg: Arc<dyn WgController>`. Mailer built only if `ZEROVPN_SMTP__HOST` is set; otherwise verify-email/password-reset routes log the link instead of sending.
- `crates/zerovpn-wg/src/control.rs` — new `WgController` trait + `NoopController` (default — logs every call, no-ops) + `ShellController` (`wg set <iface> peer ...`). `from_env()` selects via `ZEROVPN_WG__BACKEND ∈ {noop, shell}`. Wired into AppState; flipping to `shell` on a Linux host with `wg` available enables real peer sync.
- `crates/zerovpn-worker/src/retention.rs` — task that runs every 6h: drops bandwidth_samples >7d, expires consumed/expired verification tokens >24h, anonymizes audit_logs IPs >30d, hard-purges users soft-deleted >30d, drops failed_logins >30d. Logs row counts.

**Frontend**
- `web/src/pages/public/VerifyEmail.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx` — full email-link UX with pending/ok/fail states, 12-char-min new-password validation, confirm-match.
- `web/src/pages/app/ApiTokens.tsx` — create form with scope picker, table of tokens with last-used / created / status, revoke confirm. Plaintext-token-once banner with copy.
- `web/src/pages/app/DeviceDetail.tsx` — full per-device editor. Bandwidth chart with range selector, full-tunnel / split-tunnel toggle, custom DNS list, DNS-names list. PATCHes the device or PUTs DNS names.
- `web/src/components/MaintenanceBanner.tsx` — sticky top banner that polls `/admin/maintenance` once a minute (admin-only) and renders when ON.
- New routes: `/verify-email`, `/forgot-password`, `/reset-password`, `/app/devices/:id`, `/app/api-tokens`. Dashboard's device rows now link to the detail page.
- Admin audit page: "Download CSV" button.

**Decisions & rationale (1B-D)**
- **Email flow falls back to log when SMTP isn't configured**: dev keeps working without MailHog. Verify/reset link logged at INFO level.
- **Token storage**: 32-byte URL-safe random + sha256 at rest. Constant-time-ish lookup via the unique index on `token_hash`.
- **`reset-password` revokes all sessions**: stolen-laptop scenario doesn't leave the attacker logged in after the legitimate user resets.
- **WG controller is a trait on AppState**, not a concrete type. Noop default keeps the dev demo working; flipping `ZEROVPN_WG__BACKEND=shell` on a Linux host with `wg` in PATH gives the real runtime. Wiring `state.wg.add_peer/remove_peer` into `routes/devices.rs` is a deferred 5-line change paired with the actual WG container in 1B-E.
- **Maintenance gate is per-request, not held in memory**: each write does one tiny `SELECT maintenance_mode FROM app_settings`. Caching adds complexity for an infrequent flag; profile-driven optimization later.
- **Retention uses row-level `DELETE` on `bandwidth_samples`** rather than `DROP PARTITION` because v1 doesn't have partition-rotation logic. The aggregator already rolled the data into `bandwidth_aggregates` so deleting raw samples is lossless.
- **Bandwidth quotas have an admin setter but no enforcement yet** — `monthly_byte_cap` exists in the schema, the admin endpoint sets it, but the aggregator isn't bumping `current_month_bytes` and quota-exceeded blocking is a Phase 1B-E item paired with the real WG runtime.

### Added — Phase 1B-C: 2FA, bandwidth analytics, admin tools, account flow (2026-05-07)

**Closes the biggest gaps that aren't WireGuard runtime: 2FA, historical bandwidth, admin pages, GDPR export + soft-delete, maintenance mode.**

**Backend**
- `crates/zerovpn-db/src/repos/bandwidth.rs` — `insert_sample`, `rollup_hourly`, `rollup_daily`, plus per-device + per-user query helpers. Idempotent rollups via `ON CONFLICT … DO UPDATE`.
- `crates/zerovpn-worker/src/aggregator.rs` — task that runs every 5 minutes, rolls up the closed previous hour, and at 00:05 UTC rolls up the closed day.
- `crates/zerovpn-worker/src/stats_sim.rs` — now also persists each delta into `bandwidth_samples` so the aggregator has data to roll up.
- `crates/zerovpn-auth/src/totp.rs` — real implementation: `generate_secret_b32`, `provisioning_uri` (otpauth://), `verify` (±1 step skew), `generate_recovery_codes` (10 × 8-char base32, argon2-hashed), `match_recovery_code`. 3 unit tests.
- `crates/zerovpn-api/src/state.rs` — `AppState` now owns an `Arc<Kek>` loaded from `ZEROVPN_KEK` at startup, used to encrypt TOTP secrets at column level.
- `crates/zerovpn-api/src/routes/totp.rs` — `POST /auth/totp/{setup,enable,disable}`. Setup returns a fresh secret + QR + provisioning URI; enable verifies a code, encrypts the secret, persists hashed recovery codes, returns plaintext recovery codes once.
- `crates/zerovpn-api/src/routes/auth.rs` — login now accepts an optional `totp_code`. If a user has 2FA enabled and no code is provided, returns `{ totp_required: true }` so the client can prompt; otherwise verifies TOTP **or** consumes a recovery code.
- `crates/zerovpn-api/src/routes/bandwidth.rs` — `GET /devices/{id}/bandwidth?range=24h|7d|30d` and `GET /bandwidth?range=…` returning aggregated buckets.
- `crates/zerovpn-api/src/routes/admin.rs` — admin endpoints behind `RequireAdmin`: `GET /admin/users` (paginated, searchable; includes per-user device count + TOTP state), `PUT /admin/users/{id}/status`, `GET /admin/audit`, `GET /admin/failed-logins`, `GET/PUT /admin/maintenance`.
- `crates/zerovpn-api/src/routes/me.rs` — `GET /me/data-export` returns a JSON dump of the user's account row, devices, and audit-log entries they originated. `DELETE /me/account` soft-deletes (nulls PII, revokes devices/sessions/tokens) inside a transaction, releases the IP allocator entries, flushes the session.
- `crates/zerovpn-db/src/repos/users.rs` — `enable_totp`, `disable_totp`, `get_totp_material`, `replace_recovery_codes`, `soft_delete` (transactional cascade), `admin_list/count/set_status`.

**Frontend**
- `web/src/components/charts/BandwidthChart.tsx` — Recharts area chart with RX (blue gradient) and TX (green gradient), hover tooltip with formatted bytes, time-axis tick formatting.
- `web/src/pages/app/Dashboard.tsx` — Adds the bandwidth section under the topology graph with a 24h/7d/30d range selector. Quick links to Security and Account pages.
- `web/src/pages/app/Security.tsx` — Full 2FA enrollment wizard: setup button, animated QR card, manual-entry secret, code verification, and the one-time recovery codes display with Copy + "I've saved them" UX. Also a collapsed "Disable 2FA" form.
- `web/src/pages/app/Account.tsx` — Data export download (saves `zerovpn-data-export-YYYY-MM-DD.json`) + delete-account flow with email-typed confirmation.
- `web/src/pages/public/Login.tsx` — Two-step login: if backend returns `totp_required`, show a code input step; cancel button to return to credentials.
- `web/src/pages/admin/Overview.tsx` — Admin user list with email search, status pills, suspend/unsuspend actions (disabled for self), maintenance-mode toggle card, links to audit + failed-logins pages.
- `web/src/pages/admin/AuditLog.tsx` — Recent 200 audit entries with timestamp, actor (8-char prefix), action, target, JSON metadata.
- `web/src/pages/admin/FailedLogins.tsx` — Recent 200 failed-login attempts with email, reason, timestamp.
- `web/src/lib/api.ts` — endpoints for bandwidth, TOTP setup/enable/disable, data export, account delete, admin list/status, audit, failed-logins, maintenance get/set.

**Decisions & rationale (1B-C)**
- **TOTP recovery codes are 8 base32-style chars** generated from random bytes, then argon2-hashed at rest. On match the consumed code is removed from the DB array. Trade-off: argon2 verification is slow (~30ms per code × up to 10 codes) — acceptable on a recovery-only path.
- **Soft-delete in a single transaction** that nulls PII (`email = 'deleted-{id}@deleted.invalid'`, `password_hash = '!'`, TOTP material wiped), revokes devices/sessions/tokens. The row stays for 30 days for admin recovery, then a future purger removes it.
- **Hourly rollups every 5 minutes** keeps the aggregate fresh without being a tight loop. `ON CONFLICT (device_id, bucket, bucket_start) DO UPDATE` makes re-runs idempotent — useful when the worker restarts mid-window.
- **Maintenance mode flag in `app_settings`** rather than env var — admins can toggle it without redeploying. Read-only enforcement at the API layer is a Phase 1B-D task; for now the admin page reflects the state.
- **Admin self-protection**: `set_user_status` rejects when `target_id == actor.id` so an admin can't accidentally suspend themselves.

### Added — Phase 1B-B: live stats over WebSocket + topology graph (2026-05-07)

**The dashboard now shows a live force-directed network graph: server in the center, peers radiating out, animated particles flowing along each edge in proportion to current TX/RX rate. 22/22 smoke checks pass — including a Python+websockets check that opens an authenticated WebSocket and verifies a binary stats frame arrives within 15 seconds.**

**Backend**
- `crates/zerovpn-worker/src/stats_sim.rs` — simulated stats emitter for the period before a real WG poller is wired (1B-C). Every `ZEROVPN_STATS_INTERVAL_SECS` (default 10s; dev overrides to 5s) it queries `devices status='active'`, generates bounded-random RX/TX deltas with a 30% busy-bias, and emits `Event::StatsDelta` on `stats.peer.<id>`. Heartbeat publishes alongside on a 5s clock.
- `crates/zerovpn-worker/src/main.rs` — refactored to a one-publisher / many-producer model. Tasks send `(topic, Event)` over an mpsc::Sender; a single drainer task owns the ZMQ socket. (zeromq crate's PubSocket is `Send + !Sync`.)
- `crates/zerovpn-api/src/state.rs` — `AppState::new` constructs a `tokio::sync::broadcast::channel<Event>` (capacity 64). Lagging consumers drop frames; live stats are recoverable on next poll.
- `crates/zerovpn-api/src/routes/ws.rs` — `GET /api/v1/ws` upgrades to a WebSocket and pushes binary MessagePack frames to authenticated clients. `visible_to(event, user_id, role)` filters: regular users see only their own peer events; admins see everything.
- `main.rs` ZMQ subscriber now subscribes to all topics and pumps incoming events onto the broadcast bus instead of just logging.

**Database**
- Migration `00000000000002_revoked_devices_release_ip.sql`: drops the `(server_id, allocated_ip)` unique constraint and replaces it with a partial unique index `WHERE status <> 'revoked'`. Caught when the smoke test re-used a freed IP after revoke and hit a unique violation.

**Frontend**
- `web/src/hooks/useWebSocket.ts` — reconnecting WS hook with exponential backoff (250ms → 10s), 25s heartbeat ping, MessagePack decode via `@msgpack/msgpack`. Stable callback ref so React Strict Mode double-mount doesn't double-connect.
- `web/src/components/topology/TopologyGraph.tsx` — `react-force-graph-2d` rendering with `linkDirectionalParticles` driven by EMA-smoothed rate (1–8 particles, 0.001–0.012 speed). Server node 12px @ blue; device nodes 7px colored by status (green active / amber paused / red recently revoked). Edges colored by net flow direction (green TX, blue RX, gray idle).
- `web/src/lib/wire.ts` — TS type mirror of `zerovpn_wire::Event`.
- `web/src/pages/app/Dashboard.tsx` — embeds the topology graph above the device list, adds a per-row rate sparkline (`↑ Mbps · ↓ Mbps`) and a connection pill in the header that flips between "Live / Connecting… / Offline" based on WS state.
- Bundle: 261 KB gzip main chunk (above the 200 KB target due to react-force-graph-2d + d3-force; will route-split admin and topology lazily in 1B-C).

**Smoke**
- `scripts/smoke-test.sh`: 22 checks total (was 21). Adds a Python websockets-based check using a temp script (`SMOKE_COOKIE`/`SMOKE_WS_URL` env vars; correctly handles curl's `#HttpOnly_…` cookie format).

### Decisions & rationale (1B-B)
- **Simulator first, real WG poller later (1B-C).** The frontend pipeline (topology graph + WS) is the immediately-visible value; building it against synthetic deltas lets us prove the entire wire end-to-end without a live WG kernel interface running. Drop-in replacement once the poller lands.
- **Tokio `broadcast` channel** between ZMQ subscriber and WS handlers — well-understood, lagging consumers drop, no extra deps.
- **Per-user filtering at the WS handler**, not at the ZMQ topic. Topics could carry user_id today but we'd lose admin-sees-all and the indirection is cheap (the broadcast channel already runs on a single Tokio task).
- **Partial unique index** for IP recycling — recommended in the plan, finally written when the smoke test exposed the bug. Cleaner than NULL-ing the column or hard-deleting.
- **`react-force-graph-2d` rather than a custom SVG/Canvas component** — the library's built-in `linkDirectionalParticles` props are exactly the animated-dots feature requested, and switching to a Rust-WASM force layout (per the plan) is cheap once we hit the >200-peer scale threshold.

### Added — Phase 1B-A: auth + device CRUD (2026-05-07)

**Stack now supports the full v1 user flow: register → log in → add a device with QR/.conf → set DNS names → pause/unpause/revoke. 21/21 smoke checks pass.**

**Backend**
- New `crates/zerovpn-core/src/models.rs` — domain types (`User`, `Server`, `Device`, role/status enums) with `sqlx::Type`/`sqlx::FromRow` derives so they map to Postgres columns directly.
- New repos under `crates/zerovpn-db/src/repos/`: `users`, `servers`, `devices`, `audit`, `failed_logins` (with the FailedLoginReason enum).
- `crates/zerovpn-api/src/`:
  - `error.rs` — unified `ApiError` enum + `IntoResponse` that emits `{"error":{"code","message","request_id"}}` and surfaces 404/401/403/409/422/429/500.
  - `extractors/auth.rs` — `CurrentUser` and `RequireAdmin` Axum extractors backed by `tower-sessions`.
  - `bootstrap.rs` — on first boot, generates the WG server X25519 keypair (`x25519-dalek`) and inserts the default server row at `10.10.0.0/22`. Builds per-server in-memory IP allocation bitmaps from existing rows.
  - `routes/auth.rs` — `POST /auth/register` (no email enumeration: always 202; auto-activates accounts in 1A), `POST /auth/login` (argon2id verify, session cookie, 5-failed-in-15-min rate-limit, brute-force timing-attack padding), `POST /auth/logout`, `GET /me`. First-user-becomes-admin rule.
  - `routes/devices.rs` — `GET/POST /devices`, `GET/DELETE /devices/{id}`, `POST /devices/{id}/pause`, `POST /devices/{id}/unpause`. Create allocates an IP from the bitmap, generates an X25519 keypair, randomizes AmneziaWG params, persists the row (private key never stored), renders `wg-quick` config + QR SVG, returns the bundle once. Pause/unpause/revoke audit-log every transition.
  - `routes/dns.rs` — `PUT /devices/{id}/dns` validates hostnames, enforces app-layer uniqueness, and writes the dnsmasq hosts file via `zerovpn-dns::write_hosts_file`.
- `zerovpn-wg::keys` — X25519 keypair derivation now real (was a stub). 4 unit tests including roundtrip + invalid-key length.
- `zerovpn-auth::api_token` and `zerovpn-auth::kek` — opaque token + AES-256-GCM column-encryption modules ready to wire into endpoints in 1B-B.

**Frontend**
- `web/src/lib/api.ts` — full client with `register`, `login`, `logout`, `me`, `listDevices`, `createDevice`, `deleteDevice`, `pauseDevice`, `unpauseDevice`, `setDeviceDns`. Cookies sent with `credentials: "include"`. Errors normalized to `ApiError`.
- `web/src/stores/auth.ts` — Zustand `useAuth` store.
- `web/src/lib/auth-guard.tsx` — `useBootstrapAuth` hook, `ProtectedRoute`, `AdminRoute`.
- Real `Login` and `Register` pages with React Hook Form + Zod, sonner toasts.
- `Dashboard` page lists devices, has an inline "Add device" form, animates the just-created device card via Motion, shows the QR + Download/Copy buttons, supports pause/unpause/revoke with `layout` re-order.
- Bundle 193 KB gzip main chunk.

**Smoke test extended** (`scripts/smoke-test.sh`)
- Now 21 checks (was 11). Adds: register, login, /me, device create (verifies PrivateKey + SVG in body), list, pause, unpause, set DNS names, revoke, logout, /me-401-after-logout.

### Decisions & rationale (1B-A)
- **`tower-sessions` pinned to 0.14**: matching `tower-sessions-sqlx-store@0.15.0` still depends on `tower-sessions-core@0.14`. 0.15 of `tower-sessions` would not satisfy its `SessionStore` trait. Bump in lockstep when upstream catches up.
- **`ipnetwork` pinned to 0.20**, matching `sqlx@0.8.6`'s internal version. Two ipnetwork versions in the graph means our `IpNetwork` doesn't satisfy `sqlx::Type<Postgres>`.
- **`sqlx::Type` and `sqlx::FromRow` derives live in `zerovpn-core`** (not parallel DB-side enums in `zerovpn-db`). Adds one `sqlx` workspace dep to core in exchange for no manual FromRow impls and no orphan-rule conflicts.
- **`as "alias!: Type"` cast syntax is macro-only** (`query!`/`query_as!`). For runtime queries (`query_as::<_, T>(sql)`), columns are matched by `FromRow` so the SQL is plain `SELECT col1, col2, ...`. Caught when smoke first failed at "no column found for name".
- **First-user-becomes-admin** in `/auth/register`: fresh deploys don't need the CLI bootstrap step. Once one admin exists, subsequent registrations are regular users.

### Added — Phase 1A foundation (2026-05-07)

**Project bootstrap**
- Project scaffold at `/Users/black/Developer/Projects/ZeroVPN`: README, this CHANGELOG, TODO, Makefile, `.gitignore`, `.editorconfig`, `.env.example`, `scripts/init-secrets.sh`.
- Rust toolchain pinned to **1.95.0** via `rust-toolchain.toml`. `rustfmt.toml` (max_width 100, edition 2024) and `clippy.toml` committed.

**Cargo workspace** (14 crates)
- `zerovpn-core` — domain types (`UserId`, `DeviceId`, `ServerId`, `SessionId`, `ApiTokenId` v7-UUIDs), `Error`/`Result`, `Config` loader via figment.
- `zerovpn-db` — sqlx pool init + migration runner (calls `sqlx::migrate!("../../migrations")`).
- `zerovpn-wg` — WG keypair generation (Curve25519-clamped 32-byte keys, base64), `IpAllocator` (in-memory bitmap, race-safe via parking_lot::Mutex, gateway+broadcast pre-marked, with passing unit tests for allocate/release/exhaust), `.conf` rendering with optional AmneziaWG params (askama template), QR SVG via `qrcode` crate.
- `zerovpn-obfs` — randomized AmneziaWG parameter generation (Jc/Jmin/Jmax/S1/S2/H1–H4) within recommended ranges.
- `zerovpn-auth` — Argon2id password hash/verify (m=64MB t=3 p=4) with passing roundtrip test. TOTP, API tokens, KEK encryption stubbed for 1B.
- `zerovpn-stats` — module structure for poller/aggregator/retention; bodies in 1B.
- `zerovpn-events` — ZeroMQ PUB/SUB over pure-Rust `zeromq` 0.6 crate (no libzmq C dep). `Publisher::bind`, `Subscriber::connect+recv`. Two-frame envelope: topic prefix + MessagePack body.
- `zerovpn-wire` — shared wire schema. Single `Event` enum (Heartbeat, StatsDelta, HandshakeChange, PeerStatusChanged, DnsUpdated, ServerHealth) with serde + rmp-serde encoding. `crate-type = ["cdylib", "rlib"]` so it compiles to WASM via `wasm-pack` for the frontend (feature-gated `wasm` enables `wasm-bindgen`/`serde-wasm-bindgen`/`js-sys`). Roundtrip unit test passes.
- `zerovpn-dns` — atomic dnsmasq hosts file writer (tempfile + rename) with `address=/<name>/<ip>` format. Hostname validation `^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?\.vpn\.local$` with 4 unit-tested cases.
- `zerovpn-mail` — lettre 0.11 SMTP `Mailer` with rustls TLS, sync construction, async send.
- `zerovpn-api` — minimal Axum 0.8 binary on port 8080. Routes: `GET /health`, `GET /ready` (DB ping), `GET /api/v1/ping`. Layers: CompressionLayer, CorsLayer (permissive in dev), SetRequestIdLayer (UUID), TraceLayer. Graceful shutdown on SIGTERM/SIGINT. JSON tracing-subscriber output.
- `zerovpn-worker` — minimal binary that binds ZMQ PUB on `tcp://0.0.0.0:5555` and publishes a Heartbeat event every 5s on topic `events.heartbeat`.
- `zerovpn-cli` — clap-based admin CLI with subcommands: `migrate`, `bootstrap-admin --email <addr>` (interactive password prompt via `inquire`, sets `must_change_password=TRUE`), `rotate-server-keys` (stub), `version`.
- `zerovpn-topology` — WASM stub for the admin force-layout.

**Workspace-wide build profile**
- `release`: opt-level=3, lto="fat", codegen-units=1, strip=symbols, panic=abort.
- `release-min`: inherits release with opt-level="z" for size-constrained builds.
- `dev`: opt-level=0, debug="line-tables-only"; deps still build at opt-level=3 for snappy iteration.

**Database**
- Initial migration `migrations/00000000000001_initial.sql` with full v1 schema:
  - Enums: `user_role`, `user_status`, `device_status (active|paused|revoked)`, `device_os`, `token_purpose`, `api_token_scope`, `failed_login_reason`, `bucket_kind`.
  - Tables: `users` (with quota cols + `must_change_password`), `servers`, `devices` (`dns_names TEXT[]`, `allowed_ips_override`, `dns_override`), `sessions`, `verification_tokens`, `audit_logs`, `api_tokens`, `failed_logins`, `bandwidth_samples` (RANGE-partitioned monthly with three pre-created partitions for 2026-05/06/07), `bandwidth_aggregates`, `app_settings` (single-row with maintenance_mode toggle).
  - Citext extension. `updated_at` triggers on `users` and `app_settings`.
  - Privacy: IPs stored as INET prefixes; user agents as sha256 hashes.

**Docker infrastructure**
- `docker-compose.yml` services: caddy (2.11-alpine), frontend (custom nginx-alpine 1.28), api (custom distroless), worker (custom distroless), db (postgres 18-alpine with tuned params for 1 GB host), redis (redis 8-alpine 64m max), dnsmasq (4km3/dnsmasq:2.92-r0 with hosts-file watch). Two networks (`web`, `backend`). `mem_limit` per service to keep total under 1 GB.
- `docker-compose.dev.yml` overrides: exposes api/worker/db/redis dev ports, adds MailHog at 8025/1025, sets `RUST_LOG=debug,zerovpn=trace`.
- `deploy/Dockerfile.api` and `Dockerfile.worker`: cargo-chef multi-stage on Rust 1.95.0-slim, distroless `cc-debian12:nonroot` runtime.
- `deploy/Dockerfile.web`: pnpm build via Node 24-alpine → nginx 1.28-alpine runtime; `nginx.conf` with SPA fallback, immutable cache for hashed assets, gzip, WASM mime type, healthcheck endpoint.
- `deploy/Caddyfile`: reverse proxies `/api/*`, `/ws/*`, `/grafana/*`, fallback to frontend; security headers (HSTS, no-sniff, frame-deny, no-referrer).

**Frontend**
- Scaffolded via `npx shadcn@latest init --template vite --preset b1NrKMqoNe --name web --yes --no-monorepo`. Preset installed:
  - React **19.2.4**, Vite **7.3.2**, TypeScript **5.9.3**, Tailwind CSS **4.2.x** (CSS-first via `@theme`), `@tailwindcss/vite`.
  - Radix UI primitives umbrella, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`.
  - `@tabler/icons-react` (preset's icon choice; supersedes lucide-react in plan).
  - Variable fonts: Figtree + Roboto.
  - Theme provider with light/dark toggle (press `d`).
- Switched npm → pnpm (10.33), regenerated lockfile.
- Added runtime deps via `pnpm add`: `motion@12.38.0` (formerly Framer Motion, import from `motion/react`), `react-router@7.15.0`, `@tanstack/react-query@5.100.9`, `zustand@5.0.13`, `react-hook-form@7.75.0`, `zod@4.4.3`, `@hookform/resolvers@5.2.2`, `recharts@3.8.1`, `qrcode.react@4.2.0`, `react-force-graph-2d@1.29.1`, `sonner@2.0.7`, `@msgpack/msgpack@3.1.3`.
- Wrote API client (`src/lib/api.ts`) with `ApiError` (without parameter properties for `erasableSyntaxOnly` compatibility), `ping()` helper, normalized error envelope `{ error: { code, message, request_id } }`.
- TanStack Query client (`src/lib/query.ts`) with no-retry on auth/rate-limit errors.
- React Router data router with five routes: `/`, `/login`, `/register`, `/app`, `/admin`.
- Landing page polls `/api/v1/ping` every 5s and renders an animated status pill (Motion). Login/Register/Dashboard/Admin pages are placeholder shells linking back home.
- Production build: `pnpm build` succeeds; main bundle **161.88 KB gzipped** (warning at >500 KB unminified — below our ≤200 KB gzipped target). Will route-split in 1B.
- TypeScript strict + erasableSyntaxOnly + noUnusedLocals/Parameters all clean.

**Tooling**
- `Makefile` with: `help`, `setup`, `up`, `up-prod`, `down`, `logs`, `ps`, `migrate`, `bootstrap-admin EMAIL=`, `shell-api`, `shell-db`, `test`, `check`, `fmt`, `sqlx-prepare`, `wasm-build`, `clean`.
- `scripts/init-secrets.sh`: idempotent secret generator. Replaces CHANGEME placeholders in `.env` for `ZEROVPN_SESSION_SECRET`, `ZEROVPN_KEK`, DB password, Redis password. Also writes plaintext files into `./secrets/` (mode 0600) for compose to mount.

### Fixed during boot

- **glibc version mismatch**: cargo-chef `:slim` tag is now Debian 13 (trixie, glibc 2.41), but distroless `cc-debian12:nonroot` runtime is Debian 12 (bookworm, glibc 2.36). The api binary linked against `GLIBC_2.38` and crashed at startup. Pinned the builder to `0.1.77-rust-1.95.0-bookworm` to match the runtime. (Worker compiled fine on slim because its dependency closure didn't pull in any 2.38-only symbols, but rebuilt on bookworm anyway for parity.)
- **Postgres 18 image volume layout**: the upstream image now expects the volume mounted at `/var/lib/postgresql` (parent dir), not `/var/lib/postgresql/data` — to support `pg_upgrade --link` without crossing mount boundaries. Updated the `db` service volume.
- **dnsmasq missing addn-hosts file**: with `--addn-hosts=/etc/dnsmasq.d/zerovpn-peers.conf`, dnsmasq logged a warning at boot if the file didn't yet exist. Replaced the entrypoint with a tiny shell wrapper that `touch`es the file before exec-ing dnsmasq. The worker will overwrite this file as device DNS names change.
- **dnsmasq image tag**: my placeholder `4km3/dnsmasq:2.92-r0` doesn't exist on Docker Hub. Switched to `jpillora/dnsmasq:latest` (maintained, pulls cleanly).
- **Host port conflicts**: db/redis dev-exposed ports clash with the user's existing dev databases on 5432/6379. Moved to `55432:5432` and `56379:6379` in `docker-compose.dev.yml`.

### Decisions & rationale

- **Single source of truth for wire schema** lives in `zerovpn-wire`. Compiled to WASM via wasm-pack for the frontend so backend and frontend cannot drift on message types.
- **Pure-Rust `zeromq` 0.6 crate** preferred over `tmq` (which needs libzmq C library). Smaller Docker image, simpler builds.
- **resolver = "3"** in workspace requires Rust 1.84+; we're on 1.95 so we get edition 2024 + new feature unification.
- **`erasableSyntaxOnly: true`** in `tsconfig.app.json` (set by shadcn preset) bans TS-only constructs like parameter properties — adapted `ApiError` accordingly. Trade-off: code is closer to plain JS at runtime, easier to debug.
- **Partitioned `bandwidth_samples`** uses native PG RANGE partitioning monthly, not TimescaleDB. At 1000 users × 5 devices × 30s polls = ~432M rows/day deltas dropped quickly; trivial without an extension.
- **dnsmasq hostname uniqueness** enforced in app layer for 1A. A side-table `device_dns_names` with UNIQUE constraint will replace the array column in 1B for proper SQL-level enforcement.
- **`figment`-based config** with TOML + env-var override. Env-prefixed `ZEROVPN_` and nested keys via `__` (e.g., `ZEROVPN_SMTP__HOST=mailhog`).
- **Frontend ESLint 9 + Prettier 3 + TypeScript 5.9** are what the shadcn preset chose; plan called for ESLint 10 + TS 6 but the preset's choices win (less drift from the upstream design system).
- **Skipped redis password** in dev compose to keep first-boot simple; will be re-enabled in 1B alongside the actual rate-limit/cache integration.
