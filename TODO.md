# TODO

Living checklist. Format: `- [ ] short title — file/path or area`. Mark `[x]` when complete and move to the `Completed (this phase)` section. At phase milestones, completed items roll into `CHANGELOG.md`.

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `🚫` blocked (with one-line cause)

---

## Phase 1A — Foundation

### Project bootstrap
- [x] Create root files (README, CHANGELOG, TODO, Makefile, .gitignore, .editorconfig) — `/`
- [x] Initialize git repo and first commit — `/`
- [x] Add LICENSE (AGPL-3.0) — `/LICENSE`

### Workspace
- [x] Cargo workspace manifest — `Cargo.toml`
- [x] Stub all 14 crates with `Cargo.toml` + `src/lib.rs` (or `main.rs` for binaries) — `crates/zerovpn-*/`
- [x] Pin all crate versions in workspace `[workspace.dependencies]` — `Cargo.toml`
- [x] Workspace-wide release profile (LTO, strip, panic=abort) — `Cargo.toml`
- [x] `cargo check --workspace --all-targets` passes locally on macOS

### Database
- [x] Initial migration with full v1 schema — `migrations/00000000000001_initial.sql`
- [ ] sqlx-cli config + `prepare` workflow — `.sqlx/`, `Makefile` (deferred until first compile-time-checked query)

### Docker
- [x] `deploy/Dockerfile.api` (cargo-chef multi-stage, distroless runtime) — `deploy/`
- [x] `deploy/Dockerfile.worker` — `deploy/`
- [x] `deploy/Dockerfile.web` (pnpm build → nginx-alpine) — `deploy/`
- [x] `deploy/Caddyfile` — `deploy/`
- [x] `docker-compose.yml` (prod) — `/`
- [x] `docker-compose.dev.yml` (dev override with MailHog, exposed dev ports) — `/`
- [x] `.env.example` — `/`
- [x] `scripts/init-secrets.sh` (generates JWT/session/db/redis passwords into `./secrets/`) — `scripts/`

### Frontend scaffold
- [x] Run `npx shadcn@latest init --preset b1NrKMqoNe --template vite` in `web/` — `web/`
- [x] Install runtime deps (motion, react-router, @tanstack/react-query, zustand, react-hook-form, zod, @hookform/resolvers, recharts, qrcode.react, react-force-graph-2d, sonner, @msgpack/msgpack) — `web/package.json`
- [ ] Install dev deps (openapi-typescript, vite-plugin-wasm) — `web/package.json` _(deferred until OpenAPI/utoipa wired in 1B)_
- [x] Configure absolute imports + `@/` alias — `web/tsconfig.json`, `web/vite.config.ts` (preset did this)
- [x] Set up routing skeleton with public/app/admin route groups — `web/src/routes.tsx`
- [x] App shell: layout, sidebar, topbar, theme toggle — `web/src/components/layout/` _(theme toggle from preset; sidebar in 1B with auth pages)_

### Backend hello-world (api)
- [x] `zerovpn-api` minimal Axum app: `/health`, `/ready`, `/api/v1/ping` — `crates/zerovpn-api/src/main.rs`
- [x] DB pool setup with sqlx — `crates/zerovpn-db/src/pool.rs`
- [ ] Redis client setup — `crates/zerovpn-api/src/state.rs` _(deferred to 1B with rate limiting)_
- [x] Config loader (env vars + `dotenvy`) — `crates/zerovpn-core/src/config.rs`
- [x] Tracing/logging init (JSON to stdout) — inline in `crates/zerovpn-api/src/main.rs`

### Known issues (Phase 1A → 1B)
- Frontend container shows "unhealthy" in `docker ps` despite serving HTML correctly. Image's healthcheck uses `127.0.0.1` but the running container caches the older `localhost` form despite `--force-recreate`. Functionally fine (smoke test passes); Caddy doesn't gate on this. Investigate compose image-pinning and either prune+rebuild or switch healthcheck to a curl-via-explicit-IP-ENV pattern in 1B.

### End-to-end smoke ✅ ALL PASSING
- [x] `docker compose up -d` brings up api + db + redis + caddy + frontend + worker + dnsmasq + mailhog; all healthy
- [x] `curl http://localhost/api/v1/ping` → `{"pong":true,"ts_ms":...}`
- [x] `curl http://localhost/` → React SPA HTML
- [x] `curl http://localhost/healthz` → `ok` (Caddy)
- [x] api `/health` returns 200
- [x] worker is publishing ZMQ heartbeats
- [x] api ZMQ SUB receiving heartbeats every 5s (verified via `docker logs api`)
- [x] `make migrate` applies all 15 tables
- [x] `./scripts/smoke-test.sh` → 11 passed, 0 failed
- [x] `cargo test --workspace` → 11 unit tests pass

### Auth (basic) ✅ — Phase 1B-A
- [x] Argon2id password hashing — `crates/zerovpn-auth/src/password.rs`
- [x] User registration endpoint with email-enumeration prevention — `crates/zerovpn-api/src/routes/auth.rs`
- [x] Login endpoint → server session via tower-sessions — `crates/zerovpn-api/src/routes/auth.rs`
- [x] Logout endpoint — `crates/zerovpn-api/src/routes/auth.rs`
- [x] `CurrentUser` extractor — `crates/zerovpn-api/src/extractors/auth.rs`
- [x] Frontend register/login pages with RHF + Zod + sonner — `web/src/pages/public/`
- [x] First-user-becomes-admin rule
- [ ] Force-change of default admin password on first login _(flag plumbed; UI nag deferred to 1B-B)_

### Devices (basic CRUD) ✅ — Phase 1B-A
- [x] WG keypair generation (X25519 via x25519-dalek) — `crates/zerovpn-wg/src/keys.rs`
- [x] IP allocation bitmap with race-safe allocate/release — `crates/zerovpn-wg/src/ip_alloc.rs`
- [x] `.conf` rendering with AmneziaWG params — `crates/zerovpn-wg/src/config.rs`
- [ ] Add/remove peer via defguard-wireguard-rs UAPI — _stub; runtime peer-add to live WG kernel is 1B-B_
- [x] Pause/unpause via DB status — runtime detach when WG is wired in 1B-B
- [x] REST routes for devices (list/get/create/delete/pause/unpause) — `crates/zerovpn-api/src/routes/devices.rs`
- [x] Server bootstrap on first boot creates default WG server — `crates/zerovpn-api/src/bootstrap.rs`
- [x] Frontend devices list + add form + QR + .conf download + pause/unpause — `web/src/pages/app/Dashboard.tsx`

### DNS ✅ — Phase 1B-A
- [x] Hosts file writer (atomic temp+rename) — `crates/zerovpn-dns/src/lib.rs`
- [ ] dnsmasq SIGHUP — _file-watch pickup is fine for now via `--addn-hosts`; explicit SIGHUP if needed in 1B-B_
- [x] DNS names CRUD endpoint — `crates/zerovpn-api/src/routes/dns.rs`
- [x] App-layer hostname uniqueness validation
- [ ] Frontend DNS editor — _API works; UI on dedicated DeviceDetail page in 1B-B_
- [x] dnsmasq container in compose

### ZMQ pub/sub skeleton
- [x] `zerovpn-events` PUB socket bind in worker — `crates/zerovpn-events/src/publisher.rs`
- [x] `zerovpn-events` SUB socket connect in api — `crates/zerovpn-events/src/subscriber.rs`
- [x] Heartbeat publisher in worker (publishes `events.heartbeat` every 5s) — `crates/zerovpn-worker/src/main.rs`
- [x] Heartbeat subscriber wired in api startup task — `crates/zerovpn-api/src/main.rs` _(library available; api binary doesn't yet spawn a SUB task)_
- [x] Wire types in `zerovpn-wire` (Heartbeat, StatsDelta, HandshakeChange, PeerStatusChanged, DnsUpdated, ServerHealth) — `crates/zerovpn-wire/src/lib.rs`

### CLI
- [x] `zerovpn-cli bootstrap-admin --email <addr>` command (with interactive password prompt + must_change_password flag) — `crates/zerovpn-cli/src/main.rs`
- [x] `zerovpn-cli migrate` command — `crates/zerovpn-cli/src/main.rs`
- [x] `zerovpn-cli rotate-server-keys` command (stubbed) — `crates/zerovpn-cli/src/main.rs`

### CI
- [x] GitHub Actions: cargo check + clippy + sqlx prepare + frontend build + docker build — `.github/workflows/ci.yml`

---

## Phase 1B — Feature completion

### Done in 1B-A (auth + device CRUD)
- [x] argon2id register/login/logout with email-enumeration prevention + brute-force rate limit
- [x] Device CRUD with .conf + QR + AmneziaWG params + IP-allocation bitmap
- [x] DNS names per peer, dnsmasq hosts file
- [x] Pause/unpause + revoke (with DB-level IP recycling via partial unique index, added in 1B-B)
- [x] Audit log writes for every state-changing action (UI page comes later)

### Done in 1B-B (live stats + topology)
- [x] Real-time stats path: worker → ZMQ → api broadcast bus → WS → browser MessagePack
- [x] Network topology graph (react-force-graph-2d + animated particles)
- [x] Connection pill on the dashboard header (live/connecting/offline)
- [x] Per-row rate sparklines (↑ Mbps · ↓ Mbps)
- [x] Stats simulator (real WG poller is 1B-C)

### Done in 1B-D (email + device editor + retention + WG skeleton)
- [x] Email verification + password reset + resend-verify flows (lettre + MailHog dev fallback)
- [x] Per-device editor: split tunnel + custom DNS + DNS names (`PATCH /devices/{id}` + DeviceDetail page)
- [x] Audit log CSV export endpoint + frontend download button
- [x] Maintenance-mode enforcement middleware (503 for non-admin writes) + site-wide sticky banner
- [x] Bandwidth quota admin endpoint (`PUT /admin/users/{id}/quota`)
- [x] Retention purger (worker task: bandwidth samples 7d, verification tokens 24h, audit IPs 30d, soft-delete hard-purge 30d, failed_logins 30d)
- [x] WgController trait + Noop/Shell impls; controller wired into AppState (default Noop)
- 🚫 API tokens — **removed** in migration 9. The auth crate's `api_token` module + matching routes + UI page were ripped out; do not rebuild without explicit product decision.

### Done in 1B-E (WG runtime wiring + quota enforcement + observability + frontend polish)
- [x] `state.wg.add_peer/remove_peer` called from device create/revoke/pause/unpause (Noop in dev, Shell in prod)
- [x] Bandwidth quota *enforcement* in aggregator (per-user counter, auto-pause at cap)
- [x] Prometheus `/metrics` endpoint on api
- [x] WG container in `docker-compose.yml` under `--profile wg` (linuxserver/wireguard, NET_ADMIN, host-net)
- [x] `docker-compose.observability.yml` with Prometheus + Grafana + provisioned datasource
- [x] Route-splitting: admin + device-detail + change-password are lazy chunks (account + security pages are now sections inside `/app/settings`)
- [x] Idle session timeout warning toast (25min warn, 30min hard sign-out)
- [x] Force-change-password gate (login response → ProtectedRoute → /app/change-password). As of 2026-05-12 the page does an inline `POST /me/change-password` (current+new+confirm) instead of an email-reset detour.

### Done in 1C (real WG runtime + production hardening + tests + WASM + lazy-load + runbook)
- [x] Bootstrap writes `wg0.conf` to shared `wg_config` volume on first boot
- [x] Real WG stats poller via `wg show <iface> dump` (when `ZEROVPN_WG__BACKEND=shell`); `stats_sim` fallback otherwise
- [x] `pubkey_index` + `touch_handshake` repo helpers
- [x] Container hardening: `read_only`, `tmpfs`, `cap_drop: [ALL]`, `no-new-privileges` on api/worker/caddy/frontend
- [x] Loki + Promtail in observability profile (Grafana datasource pre-provisioned)
- [x] Backup container (`offen/docker-volume-backup`) with optional age encryption + 14-day retention
- 🚫 Webhooks — **removed** in migration 10. Table + enum + repo + admin endpoints + dispatcher were all ripped out; the landing page copy still mentions them but no working surface remains.
- [x] OpenAPI 3.1 spec at `GET /openapi.json` (hand-curated, 30+ paths)
- [x] Integration test crate (`tests/`) using `testcontainers-modules`; one happy-path test: create + find_by_email + quota counter + soft-delete
- [x] Playwright E2E setup (`web/playwright.config.ts` + `web/e2e/smoke.spec.ts`) with register → login → add device flow
- [x] Lazy-load topology graph + Recharts via wrapper components — main bundle 366 KB → **202 KB gzip**
- [x] WASM wire deserializer crate (zerovpn-wire with `cdylib` + `wasm-bindgen` exports); build via `wasm-pack build crates/zerovpn-wire --target web --release`
- [x] Production runbook (`docs/runbook.md`) with WG-on-Linux setup, observability bring-up, backup/restore drill, security checklist, hardening notes

### Still open (true v1 carry-overs — small)
- [x] Suspicious-login email on new IP-prefix per user — wired in `routes/auth.rs` (login flow compares the request's IP prefix against `users.last_login_ip_prefix` and fires a `SuspiciousLogin` template on mismatch).
- [x] OpenAPI generation via `utoipa` derives — every handler annotated with `#[utoipa::path]`, every DTO derives `ToSchema`, single `ApiDoc` aggregator in `routes/openapi.rs` builds the spec at runtime. Hand-curated path list is gone; drift detector test in `openapi::tests` fails the build if a new handler is added without a path attribute.
- [x] `defguard-wireguard-rs` UAPI peer add/remove — new `KernelController` (Linux-only, gated on `cfg(target_os = "linux")`) drives peers via netlink/UAPI through `WGApi<Kernel>`. Selected via `ZEROVPN_WG__BACKEND=kernel`; legacy `shell` backend retained for environments that can't reach the netlink socket. Falls back to `NoopController` on non-Linux hosts.
- [ ] WASM wire deserializer wired into the frontend WS hook (crate + bindings ready; JS path used today)
- [ ] More integration-test coverage beyond the one happy-path
- [ ] GitHub Actions CI workflow (`.github/workflows/ci.yml`) — never landed

### Done 2026-05-12 (session corrections + polish)
- [x] **IPv6 CIDR allocation** — `IpAllocator` is now an enum dispatching V4 (bitmap) / V6 (sparse HashSet + monotonic cursor). Bootstrap no longer skips IPv6 server rows. 9 unit tests including 4 IPv6 paths.
- [x] **`zerovpn-cli rotate-server-keys`** — real implementation. Accepts `--server-id <uuid>`, `--all`, `--yes`. Mirrors the API handler: mints new keypair → rewrites `wg0.conf` → updates `servers.public_key` → audits as `cli.server_keys_rotated`.
- [x] **`POST /me/change-password`** — authenticated in-place change. Verifies current password, hashes new, calls `update_password` (which bumps `password_changed_at`), then re-syncs the current session's snapshot so this tab stays alive while every *other* session dies on its next request. UI lives in `Settings → Security` and on the forced-change `/app/change-password` page.
- [x] **Verification email base64 transfer encoding** — `Mailer::send` now uses `SinglePart` with explicit `Base64` Content-Transfer-Encoding. Fixes the previous QP-induced URL fragmentation (`=3D` artifacts + 76-col soft wrap mid-token).
- [x] **Server-stats panel visible to all users** — WS filter now passes `ServerHealth` events to non-admins; sidebar drops the `isAdmin` gate. `Heartbeat` and `ServerSample` stay admin-only.
- [x] **Finder moved under `/admin/finder`** — workspace nav entry deleted; admin-only by route guard + sidebar + command palette.
- [x] **Account / Security merged into Settings tabs** — standalone `/app/account` and `/app/security` routes removed; UserMenu links now deep-link to `/app/settings#account` / `#security`.
- [x] **Tooltips across the app** — shared `<WithTooltip>` helper; auto-applied via the `IconBtn` swiss primitive; explicit wraps on topology controls, TopBar, Devices, Finder, DeviceCard, DeviceDetail, ResetPassword. ModeToggle + UserMenu now tooltip on hover (suppressed while their dropdown is open).
- [x] **Orphan code removed** — `crates/zerovpn-auth/src/api_token.rs` + `ApiTokenId` newtype (feature was dropped in migration 9 but the module lingered).
- [x] **Broken suspicious-login email link fixed** — was `/app/security` (route deleted), now `/app/settings#security`.

These are minor polish items; the core v1 product is done.

---

## Phase 1C — Hardening & polish

- [x] Prometheus + Grafana + Loki + Promtail observability stack
- [x] Provisioned Grafana dashboards (API latency, peer count, traffic, DB connections)
- [x] Backup container (offen/docker-volume-backup) with age encryption
- [x] Container hardening: read-only FS, drop caps, distroless non-root
- [x] OpenAPI spec at `/openapi.json` (hand-curated; utoipa derive deferred)
- 🚫 Webhook backend — **removed** in migration 10.
- [x] E2E tests (Playwright)
- [x] Integration tests (testcontainers)
- [x] Production deployment guide + runbook (`docs/runbook.md`)
- [x] WASM wire deserializer crate (wasm-pack pipeline ready; opt-in)
- [x] Server config editor (admin) — `/admin/servers/{id}` PATCH + `pages/admin/Servers.tsx` (`adminPatchServer`)
- [x] Force key rotation (admin) — `/admin/servers/{id}/rotate-keys` POST + UI confirm dialog in `Servers.tsx`
- [ ] Load test harness (Locust/k6 against API; wg-bench for tunnel) — deferred
- [ ] WASM topology layout for >200 peers — deferred (JS path scales fine for v1)
- [ ] frontend type generation from `/openapi.json` in CI — now a one-liner with `openapi-typescript` since the spec is utoipa-derived from handler attributes

**Phase 1C verification (2026-05-07): 22/22 smoke tests passing against rebuilt stack. `/openapi.json` returns 32 paths. `/metrics` reachable. Stack memory ~600 MB idle.**

---

## Phase 2 — Full logging system

**Policy:** capture, retain, and surface every operational event. The "no-log" posture is reversed. See `CHANGELOG.md` → "Policy reversal — full logging system (2026-05-13)" for rationale and the public-copy / compliance prerequisites.

**Staging.** Stages A and B are toggles + small code changes against the existing surface; they can ship together. Stage C needs new container-level infrastructure (logging resolver, netfilter export) and is sized as its own milestone. Stage D is the compliance counterweight — it must ship alongside C, not after.

### Stage A — Stop suppressing what we already capture — ✅ shipped 2026-05-13

- [x] **Drop audit-log IP anonymization** — anonymization pass removed from `retention.rs`. IPs now retained for the lifetime of the row.
- [x] **Widen IP storage from /24 prefix to full address** — `client_ip_prefix()` → `client_ip()` in `routes/auth.rs`; returns `IpNetwork::from(IpAddr)` as `/32`/`/128`. The INET columns accept it unchanged; column names left as-is.
- [x] **Stop purging `failed_logins` at 30 days** — retention rule deleted.
- [x] **Store user-agent strings in plaintext** — `failed_logins.user_agent_hash` and `sessions.user_agent_hash` renamed to `user_agent` (migration 14); `audit_logs.user_agent` added (migration 16); `audit::record_with_ua` helper lets opted-in routes populate it without sweeping the 33 existing `AuditEntry { ... }` literals.
- [x] **Capture WireGuard peer endpoint** — `wg_poller` now reads `cols[2]`; `devices.last_peer_endpoint` + `peer_endpoint_history` table added (migration 15). On-change detection via in-memory baseline so per-tick polling doesn't hammer the DB.
- [x] **Make `bandwidth_samples` retention indefinite by default explicit** — `ZEROVPN_SAMPLE_RETENTION_DAYS` + `ZEROVPN_SERVER_SAMPLE_RETENTION_DAYS` env vars no longer consulted; samples always retained. Operator-tunable retention returns in Stage D.
- [x] **Landing copy + privacy policy** — every "no-log" claim on `pages/public/Landing.tsx` rewritten honestly; FAQ "Do you keep traffic logs?" replaced with "What does ZeroVPN log?" enumerating every retained surface and the carve-outs (no DPI / DNS / destination). README tagline updated.

**Stage A debt carried into Stage B:** schema-cleanup migration that renames `*.ip_prefix` → `*.ip` and `users.last_login_ip_prefix` → `last_login_ip` (the column names still say "prefix" but store full IPs). Bundle this with the `access_logs` migration so it's one disruption, not two.

### Stage B — New schema, new admin surfaces ✅ shipped 2026-05-14

- [x] **Session events table** — append-only `session_events`: `user_id`, `event` ∈ `{login, logout, idle_timeout, suspicious_login, password_change, totp_enable, totp_disable, impersonation_start, impersonation_end}`, `ip`, `user_agent`, `created_at`. Surfaced as [web/src/pages/admin/Sessions.tsx](web/src/pages/admin/Sessions.tsx).
- [x] **Connection events table** — the WG poller now writes `connection_sessions` rows with peer endpoint snapshots + session duration on disconnect. Surfaced in the per-device connection history panel on [web/src/pages/admin/DeviceDetail.tsx](web/src/pages/admin/DeviceDetail.tsx).
- [x] **Per-request access log** — middleware records `method`, `path`, `status`, `latency_ms`, `user_id`, `ip`, `user_agent`, `request_id` for every authenticated request. Backed by `access_logs` and surfaced at [web/src/pages/admin/AccessLogs.tsx](web/src/pages/admin/AccessLogs.tsx).
- [x] **Schema-cleanup migration** — [migrations/00000000000020_rename_ip_columns.sql](migrations/00000000000020_rename_ip_columns.sql) renamed `audit_logs.ip_prefix` → `ip`, `failed_logins.ip_prefix` → `ip`, `users.last_login_ip_prefix` → `last_login_ip`, and the matching repo helper.
- [x] **`/admin/devices/{id}` page** — admins now have a dedicated device-detail page with connection history, endpoint history, bandwidth chart, and device-targeted audit context: [web/src/pages/admin/DeviceDetail.tsx](web/src/pages/admin/DeviceDetail.tsx).
- [x] **Per-user activity timeline** — [web/src/pages/admin/UserDetail.tsx](web/src/pages/admin/UserDetail.tsx) merges audit, session, and connection rows into one timeline for `/admin/users/{id}`.
- [x] **Admin search by IP / user-agent / endpoint** — [web/src/pages/app/Finder.tsx](web/src/pages/app/Finder.tsx) accepts IP, `host:port`, email, device name, and User-Agent fragments, with cross-source counts and deep links.

### Stage C — Network-level capture (new infrastructure)

- [x] **DNS query log** — replace the existing `dnsmasq` container with a logging resolver. Current bridge: CoreDNS now logs queries to stdout and reloads the shared hosts file; next step is shipping records into `dns_queries` or Loki. Two options:
  - **Unbound** with `qname-log` + `log-replies: yes` → tail logs into a `dns_queries` table or a Loki stream.
  - **Custom Rust resolver** (`hickory-dns` / `trust-dns-server`) writing directly to Postgres. More work; tighter integration; preferred long-term.
- [~] **Destination IP log** — netfilter `NFLOG` target or `conntrack-tools` export in the WG container's netns; ship via `ulogd2` → Postgres (or Loki). Per-flow record: `peer_id` (resolved via peer src_ip), `dst_ip`, `dst_port`, `proto`, `bytes_in`, `bytes_out`, `started_at`, `ended_at`.
  - [x] **Ingestor infrastructure** — scaffolded the full pipeline:
    - `migrations/00000000000021_destination_ips.sql` — `destination_ips` table with device/user fk and per-flow columns
    - `crates/zerovpn-db/src/repos/destination_ips.rs` — insert/query repo helpers
    - `crates/zerovpn-worker/src/destination_ingest.rs` — TCP/JSON listener on `ZEROVPN_INGEST__DEST_BIND` (default `0.0.0.0:9898`); resolves src_ip → device/user; writes to repo
    - `scripts/ulogd-exporter.py` — Python exporter transforms ulogd JSON → flow format
    - `deploy/ulogd.conf` — ulogd2 config template for NFLOG → JSON
    - `deploy/Dockerfile.nflog-exporter` — exporter container
    - `docker-compose.yml` — worker ingest port exposed; `nflog-exporter` service under `ingest` profile
    - `docs/STAGE_C_INGEST.md` — architecture & usage guide
    - ✅ Run: `bash scripts/test-stage-c.sh` to validate
  - [ ] **NFLOG → ulogd2 integration** — wire real netfilter events from WG netns to ulogd2 container; add container + iptables rules to WG entrypoint.
- [x] **Geo enrichment** — MaxMind GeoLite2 lookup on destination IPs at write time:
  - `crates/zerovpn-core/src/geo.rs` — `GeoReader` wrapper with thread-safe lookup
  - `migrations/00000000000022_destination_ips_geo.sql` — adds latitude, longitude, country_code, country_name, city_name columns + indexes
  - `crates/zerovpn-db/src/repos/destination_ips.rs` — updated insert signature to accept geo fields
  - `crates/zerovpn-worker/src/destination_ingest.rs` — integrates GeoReader, loads from `ZEROVPN_GEO_DB_PATH`, enriches each flow at ingest
  - Workspace: ✅ Compiles cleanly, all geo fields optional (best-effort enrichment)
- [ ] **Admin per-device traffic explorer** — drill from a device into its DNS history + destination history, with date range + filters.

### Stage D — Compliance counterweights (must ship with Stage C)

- [ ] **Per-table retention windows in `app_settings`** — operator-tunable `retention_*` columns for each new table (raw samples, access logs, audit, sessions, DNS queries, dest IPs). Worker retention task reads from `app_settings` on each pass.
- [ ] **Update `/me/data-export`** — already exists; extend to include every new table so the per-user JSON dump remains a complete picture.
- [ ] **Per-user data-deletion workflow** — admin action that hard-deletes one user's rows across every log table in a single transaction (GDPR Art. 17 / CCPA right-to-erasure). Backed by a `users::purge_logs_for(user_id)` repo call.
- [ ] **Lawful-intercept / jurisdiction disclaimer in runbook** — `docs/runbook.md` gets a "logging legal exposure" section enumerating: jurisdictions where DNS / destination logging triggers data-protection authority registration; jurisdictions requiring lawful-intercept licensing; recommended default retention windows by region.
- [ ] **Audit who reads the logs** — admin actions that view logs (audit list, sessions list, DNS / destination explorer) emit their own `audit_logs` rows so "who looked at user X's history" is itself answerable.

🚫 **Not in scope:** traffic payload / DPI. Requires breaking the tunnel cryptography (MITM CA, or operating outside the WG protocol) and in most jurisdictions a lawful-intercept license. Separate product decision; do not pull into Phase 2.

---

## Deferred (v2)

- Multi-region / multi-server orchestration
- wstunnel obfuscation escape hatch
- Multi-hop / chained VPN
- Site-to-site / mesh
- Native desktop/mobile clients
- OAuth (Google/GitHub)
- Subscription/billing
- Public status page
- Internationalization (i18n)
- PWA / offline mode
- Push notifications
- Geolocation-based blocking
- Webhook configuration UI (backend exists in 1C, UI deferred)
- IP allowlist for admin login
- Login from new device alerts (full device fingerprinting)
- 3D topology view

---

## Completed (Phase 1A — 2026-05-07)

All Phase 1A foundation items above are done. Phase 1A milestone cut at commit `f39001b` + boot-verification commit. Highlights rolled into [CHANGELOG.md](CHANGELOG.md) under `[0.1.0] — 2026-05-07`.

**Phase 1A summary:**
- 14-crate Cargo workspace, all compiling on Rust 1.95
- 11 unit tests passing (auth password, kek, api_token; wg ip_alloc; dns hostname; wire roundtrip)
- Initial schema migration with 11 logical tables + 3 partitions
- Docker Compose stack booting all 8 services healthy
- Frontend skeleton with router, query, motion-animated landing page
- Smoke test 11/11 ✅
- ZeroMQ end-to-end: worker PUB → api SUB → log
- Two git commits, AGPL-3.0 LICENSE, AGENTIC CHANGELOG, CI workflow stub

---

## Completed (Phase 2 / Stage A — 2026-05-13)

The "no-log VPN" posture is reversed. Highlights rolled into [CHANGELOG.md](CHANGELOG.md) under the `[Unreleased]` "Phase 2 / Stage A — full logging system shipped" entry.

**Migrations shipped:**
- `00000000000014_full_logging_stage_a.sql` — rename `failed_logins.user_agent_hash` → `user_agent`, `sessions.user_agent_hash` → `user_agent`
- `00000000000015_peer_endpoints.sql` — `devices.last_peer_endpoint TEXT` + `last_peer_endpoint_at TIMESTAMPTZ`, new `peer_endpoint_history` append-only table with two indexes
- `00000000000016_audit_user_agent.sql` — `audit_logs.user_agent TEXT`

**Retention purger** ([crates/zerovpn-worker/src/retention.rs](crates/zerovpn-worker/src/retention.rs)) — 4 rules deleted (audit-log IP anonymization, `failed_logins` purge, both bandwidth-sample env-controlled retentions). Survivors: verification-token expiry, soft-deleted-user purge, pending-verification-account purge.

**Auth flow** ([crates/zerovpn-api/src/routes/auth.rs](crates/zerovpn-api/src/routes/auth.rs)) — `client_ip()` + `client_user_agent()` helpers; every `failed_logins::record(...)` call in `login()` now passes IP + UA; `register()` accepts `HeaderMap` and records IP + UA via `audit::record_with_ua`; suspicious-login detection compares full IPs (more sensitive than the previous /24 baseline).

**WG poller** ([crates/zerovpn-worker/src/wg_poller.rs](crates/zerovpn-worker/src/wg_poller.rs)) — `Cumulative` struct gained `endpoint: Option<String>`; parser now reads `cols[2]`; on-change detection writes `devices.last_peer_endpoint` + appends to `peer_endpoint_history`.

**Audit API** ([crates/zerovpn-db/src/repos/audit.rs](crates/zerovpn-db/src/repos/audit.rs)) — new `record_with_ua(pool, entry, user_agent)` writes the UA column; existing `record(pool, entry)` delegates with `None`. Avoids the 33-call-site struct-literal sweep; routes opt in piecemeal.

**Admin surfaces:**
- `pages/admin/AuditLog.tsx` — new IP + User-Agent columns; CSV export carries them too; subtitle no longer claims "180-day retention"
- `pages/admin/FailedLogins.tsx` — new IP + User-Agent columns; subtitle no longer claims "/24 prefixes only"
- `pages/admin/UserDetail.tsx` — devices table gained a clickable "Last endpoint" column; click opens `EndpointHistoryDialog` showing every distinct `host:port` observed for the device (newest first, capped at 200)
- `GET /admin/devices/{id}/endpoint-history` endpoint backing the dialog

**Public copy** — every "no-log" claim on `pages/public/Landing.tsx` rewritten:
- Hero eyebrow / paragraph: "Full admin visibility" replaces "No-logs" / "No traffic logs"
- Persona P/03 reframed from "Privacy operator" to "Compliance operator"
- Security 09.4: "5/15min/email rate-limit, full IP + UA retained" (was "/24 prefix tracking")
- Security 09.6: "Full audit trail" with indefinite retention (was "Audit · 180 days")
- FAQ: "Do you keep traffic logs?" → **"What does ZeroVPN log?"** with the full enumeration
- CTA: "Stop renting your privacy" → "Own your infrastructure"
- README tagline dropped "(no-logs)"; points readers at the CHANGELOG policy entry

**Build status** — `cargo check --workspace` clean. `npx tsc --noEmit` clean.

**Deferred to Stage B:** schema-cleanup migration renaming the misleading `*.ip_prefix` columns to `*.ip` (currently they store full IPs but the name still says "prefix"). Bundling with the `access_logs` migration keeps it to one operational disruption.
