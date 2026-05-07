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
