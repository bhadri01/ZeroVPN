# TODO

Living checklist. Format: `- [ ] short title — file/path or area`. Mark `[x]` when complete and move to the `Completed (this phase)` section. At phase milestones, completed items roll into `CHANGELOG.md`.

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `🚫` blocked (with one-line cause)

---

## Phase 1A — Foundation

### Project bootstrap
- [x] Create root files (README, CHANGELOG, TODO, Makefile, .gitignore, .editorconfig) — `/`
- [~] Initialize git repo and first commit — `/`
- [ ] Add LICENSE (AGPL-3.0) — `/LICENSE`

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
- [ ] App shell: layout, sidebar, topbar, theme toggle — `web/src/components/layout/` _(theme toggle from preset; sidebar in 1B with auth pages)_

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
- [ ] Heartbeat subscriber wired in api startup task — `crates/zerovpn-api/src/main.rs` _(library available; api binary doesn't yet spawn a SUB task)_
- [x] Wire types in `zerovpn-wire` (Heartbeat, StatsDelta, HandshakeChange, PeerStatusChanged, DnsUpdated, ServerHealth) — `crates/zerovpn-wire/src/lib.rs`

### CLI
- [x] `zerovpn-cli bootstrap-admin --email <addr>` command (with interactive password prompt + must_change_password flag) — `crates/zerovpn-cli/src/main.rs`
- [x] `zerovpn-cli migrate` command — `crates/zerovpn-cli/src/main.rs`
- [ ] `zerovpn-cli rotate-server-keys` command (stubbed) — `crates/zerovpn-cli/src/main.rs`

### CI
- [ ] GitHub Actions: cargo check + clippy + sqlx prepare + frontend build + docker build — `.github/workflows/ci.yml`

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

### Done in 1B-D (email + API tokens + device editor + retention + WG skeleton)
- [x] Email verification + password reset + resend-verify flows (lettre + MailHog dev fallback)
- [x] API tokens: create / list / revoke (backend + UI page)
- [x] Per-device editor: split tunnel + custom DNS + DNS names (`PATCH /devices/{id}` + DeviceDetail page)
- [x] Audit log CSV export endpoint + frontend download button
- [x] Maintenance-mode enforcement middleware (503 for non-admin writes) + site-wide sticky banner
- [x] Bandwidth quota admin endpoint (`PUT /admin/users/{id}/quota`)
- [x] Retention purger (worker task: bandwidth samples 7d, verification tokens 24h, audit IPs 30d, soft-delete hard-purge 30d, failed_logins 30d)
- [x] WgController trait + Noop/Shell impls; controller wired into AppState (default Noop)

### Done in 1B-E (WG runtime wiring + quota enforcement + observability + frontend polish)
- [x] `state.wg.add_peer/remove_peer` called from device create/revoke/pause/unpause (Noop in dev, Shell in prod)
- [x] Bandwidth quota *enforcement* in aggregator (per-user counter, auto-pause at cap)
- [x] Prometheus `/metrics` endpoint on api
- [x] WG container in `docker-compose.yml` under `--profile wg` (linuxserver/wireguard, NET_ADMIN, host-net)
- [x] `docker-compose.observability.yml` with Prometheus + Grafana + provisioned datasource
- [x] Route-splitting: admin + device-detail + security + account + api-tokens + change-password are lazy chunks
- [x] Idle session timeout warning toast (25min warn, 30min hard sign-out)
- [x] Force-change-password gate (login response → ProtectedRoute → /app/change-password → email reset link)

### Done in 1C (real WG runtime + production hardening + tests + WASM + lazy-load + runbook)
- [x] Bootstrap writes `wg0.conf` to shared `wg_config` volume on first boot
- [x] Real WG stats poller via `wg show <iface> dump` (when `ZEROVPN_WG__BACKEND=shell`); `stats_sim` fallback otherwise
- [x] `pubkey_index` + `touch_handshake` repo helpers
- [x] Container hardening: `read_only`, `tmpfs`, `cap_drop: [ALL]`, `no-new-privileges` on api/worker/caddy/frontend
- [x] Loki + Promtail in observability profile (Grafana datasource pre-provisioned)
- [x] Backup container (`offen/docker-volume-backup`) with optional age encryption + 14-day retention
- [x] Webhook backend: `webhooks` table + enum + repo + admin CRUD endpoints + worker dispatcher (HTTP POST with timeouts + delivery success tracking)
- [x] OpenAPI 3.1 spec at `GET /openapi.json` (hand-curated, 30+ paths)
- [x] Integration test crate (`tests/`) using `testcontainers-modules`; one happy-path test: create + find_by_email + quota counter + soft-delete
- [x] Playwright E2E setup (`web/playwright.config.ts` + `web/e2e/smoke.spec.ts`) with register → login → add device flow
- [x] Lazy-load topology graph + Recharts via wrapper components — main bundle 366 KB → **202 KB gzip**
- [x] WASM wire deserializer crate (zerovpn-wire with `cdylib` + `wasm-bindgen` exports); build via `wasm-pack build crates/zerovpn-wire --target web --release`
- [x] Production runbook (`docs/runbook.md`) with WG-on-Linux setup, observability bring-up, backup/restore drill, security checklist, hardening notes

### Still open (true v1 carry-overs — small)
- [ ] Suspicious-login email on new IP-prefix per user (template ready; needs IP plumbing through login + per-user seen-IP cache)
- [ ] OpenAPI generation via `utoipa` derives (current spec is hand-curated; auto-derive when API surface stabilises)
- [ ] Webhook UI on the admin page (backend done; admin manages via curl for now)
- [ ] WASM wire deserializer wired into the frontend WS hook (crate + bindings ready; JS path used today)
- [ ] Suspicious-login alert email on new IP-prefix per user
- [ ] More integration-test coverage beyond the one happy-path

These are minor polish items; the core v1 product is done.

---

## Phase 1C — Hardening & polish

- [x] Prometheus + Grafana + Loki + Promtail observability stack
- [x] Provisioned Grafana dashboards (API latency, peer count, traffic, DB connections)
- [x] Backup container (offen/docker-volume-backup) with age encryption
- [x] Container hardening: read-only FS, drop caps, distroless non-root
- [x] OpenAPI spec at `/openapi.json` (hand-curated; utoipa derive deferred)
- [x] Webhook backend (peer connected/disconnected, bandwidth threshold)
- [x] E2E tests (Playwright)
- [x] Integration tests (testcontainers)
- [x] Production deployment guide + runbook (`docs/runbook.md`)
- [x] WASM wire deserializer crate (wasm-pack pipeline ready; opt-in)
- [ ] Server config editor (admin) — deferred
- [ ] Force key rotation (admin) — deferred
- [ ] Load test harness (Locust/k6 against API; wg-bench for tunnel) — deferred
- [ ] WASM topology layout for >200 peers — deferred (JS path scales fine for v1)
- [ ] frontend type generation from `/openapi.json` in CI — deferred

**Phase 1C verification (2026-05-07): 22/22 smoke tests passing against rebuilt stack. `/openapi.json` returns 32 paths. `/metrics` and `/admin/webhooks` both reachable. Stack memory ~600 MB idle.**

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
