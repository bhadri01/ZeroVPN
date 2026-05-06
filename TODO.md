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

### End-to-end smoke
- [~] `docker compose up -d` brings up api + db + redis + caddy + frontend; all healthy _(images building)_
- [ ] Visit `https://localhost/api/v1/ping` → `{ "pong": true }`
- [ ] Visit `https://localhost` → frontend loads
- [ ] Visit `https://localhost/health` → `{ "status": "ok" }`

### Auth (basic)
- [ ] Argon2id password hashing — `crates/zerovpn-auth/src/password.rs`
- [ ] User registration endpoint (no email verify yet; auto-active in dev) — `crates/zerovpn-api/src/routes/auth.rs`
- [ ] Login endpoint → server session via tower-sessions — `crates/zerovpn-api/src/routes/auth.rs`
- [ ] Logout endpoint → revoke session — `crates/zerovpn-api/src/routes/auth.rs`
- [ ] `current_user` extractor — `crates/zerovpn-api/src/extractors/`
- [ ] Frontend register/login pages — `web/src/pages/public/`
- [ ] Force-change of default admin password on first login

### Devices (basic CRUD)
- [ ] WG keypair generation — `crates/zerovpn-wg/src/keys.rs`
- [ ] IP allocation bitmap — `crates/zerovpn-wg/src/ip_alloc.rs`
- [ ] `.conf` rendering with AmneziaWG params — `crates/zerovpn-wg/src/config.rs`
- [ ] Add/remove peer via defguard-wireguard-rs UAPI — `crates/zerovpn-wg/src/control.rs`
- [ ] Pause/unpause peer — `crates/zerovpn-wg/src/pause.rs`
- [ ] REST routes for devices — `crates/zerovpn-api/src/routes/devices.rs`
- [ ] Frontend devices list + detail + add wizard — `web/src/pages/app/`
- [ ] QR code rendering on device detail — `web/src/components/device/QRDisplay.tsx`

### DNS
- [ ] Hosts file writer (atomic temp+rename) — `crates/zerovpn-dns/src/lib.rs`
- [ ] dnsmasq reload signal (SIGHUP) — `crates/zerovpn-dns/src/reload.rs`
- [ ] DNS names CRUD endpoints — `crates/zerovpn-api/src/routes/dns.rs`
- [ ] Frontend DNS editor on device detail — `web/src/pages/app/DeviceDetail.tsx`
- [ ] dnsmasq container in compose — `docker-compose.yml`

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

## Completed (this phase)

_Items move here as they're finished, then roll into CHANGELOG.md at phase milestone._
