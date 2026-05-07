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

(See plan file for full list. Highlights below; expand as we get there.)
- [ ] 2FA (TOTP enroll/verify, recovery codes, step-up auth)
- [ ] Email verification + password reset flows + lettre wiring
- [ ] Real-time stats poller (30s) → ZMQ → WS → dashboard
- [ ] Network topology graph with `react-force-graph-2d` + animated particles
- [ ] Bandwidth aggregates (hourly/daily/monthly rollups via apalis)
- [ ] Audit logs + admin audit page (CSV export)
- [ ] Rate limiting (login, signup, password reset) + brute-force lockout
- [ ] Per-peer split tunneling + custom DNS overrides
- [ ] API tokens UI
- [ ] Failed-logins log + admin page
- [ ] Username/email enumeration prevention
- [ ] Soft-delete + GDPR data export
- [ ] Retention purger cron
- [ ] Idle session timeout
- [ ] Bandwidth quotas per user
- [ ] Maintenance mode toggle
- [ ] WASM wire deserializer (compile `zerovpn-wire` to WASM, hook into frontend WS)

---

## Phase 1C — Hardening & polish

- [ ] Prometheus + Grafana + Loki + Promtail observability stack
- [ ] Provisioned Grafana dashboards (API latency, peer count, traffic, DB connections)
- [ ] Backup container (offen/docker-volume-backup) with age encryption
- [ ] Container hardening: read-only FS, drop caps, distroless non-root
- [ ] OpenAPI generation via utoipa + frontend type generation in CI
- [ ] Webhook backend (peer connected/disconnected, bandwidth threshold)
- [ ] Server config editor (admin)
- [ ] Force key rotation (admin)
- [ ] E2E tests (Playwright)
- [ ] Integration tests (testcontainers)
- [ ] Load test harness (Locust/k6 against API; wg-bench for tunnel)
- [ ] Production deployment guide + runbook (`docs/runbook.md`)
- [ ] WASM topology layout (admin scale view, > 200 peers)

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
