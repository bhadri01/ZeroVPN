# Runbook

## Dev vs. prod isolation

ZeroVPN ships a single `docker-compose.yml` + single `.env`. Dev vs. prod is driven by `.env` values; optional service groups (MailHog, WG, ingest) come up via compose **profiles**:

| | dev | prod |
|---|---|---|
| Compose invocation | `docker compose --profile dev up -d` (via `make up`) | `docker compose up -d` (via `make up-prod`) |
| Env file | `.env` (from `.env.example`) — `ZEROVPN_ENVIRONMENT=dev` | `.env` (same file, edited) — `ZEROVPN_ENVIRONMENT=production` |
| TLS | self-signed (`ZEROVPN_CERT_RESOLVER` empty → Traefik default cert) | Let's Encrypt (`ZEROVPN_CERT_RESOLVER=le` in `.env`) |
| Exposed host ports | 80, 443, 51820/udp + loopback-only 18080/5555/55432/56379 + 8025 (MailHog via `dev` profile) | 80, 443, 51820/udp + loopback-only 18080/5555/55432/56379 (no MailHog) |
| Mailer | MailHog (via `dev` profile) | real SMTP relay (set `ZEROVPN_SMTP__HOST` in `.env`) |
| WG backend | `noop` (userspace boringtun in api-dev) | `kernel` (set in `.env`; the api is the WG host — no `wg` container) |
| Session cookie | not Secure (plaintext localhost) | Secure flag set (api enforces when `ZEROVPN_ENVIRONMENT=production`) |

Compose profiles compose: `--profile dev --profile ingest` enables both.

## First-time setup (dev)

```
git clone <this repo>
cd zerovpn
make setup                                  # copies .env.example → .env, generates secrets, builds images
make up                                     # docker compose --profile dev up -d
make migrate
make bootstrap-admin EMAIL=admin@example.com   # interactive password prompt
```

The bootstrap admin lands as `must_change_password=TRUE` and is forced through the email-link reset on first login (MailHog catches mail at <http://localhost:8025>).

## Fast dev loop (native cargo + Vite HMR)

`make up` runs everything in docker — fine for verifying the prod-shape build, but slow when iterating on code (every change = `docker compose build`). For fast iteration, run only the *infrastructure* (db, dnsmasq, mailhog) in docker and run `api` / `worker` / `frontend` natively. Frontend gets Vite HMR (<100 ms); backend uses cargo's incremental compile (~3–10 s after a small change).

```
make dev                                    # one-time: stops dockerized api/worker/frontend, starts db/redis/mailhog/dnsmasq
make dev-migrate                            # run migrations (only first time, or after a new migration)
make dev-bootstrap-admin EMAIL=you@example.com   # only first time

# In three separate terminals:
make dev-api                                # cargo run -p zerovpn-api  → 127.0.0.1:8080
make dev-worker                             # cargo run -p zerovpn-worker → tcp://127.0.0.1:5555
make dev-web                                # vite dev server          → http://localhost:6173
```

Open <http://localhost:6173> in your browser. The Vite dev server proxies `/api/*` and `/ws/*` to `127.0.0.1:8080`, so the api round-trip works transparently. MailHog stays at <http://localhost:8025>.

How it works:

- [scripts/dev-native.sh](../scripts/dev-native.sh) sources `.env` then rewrites the docker-network hostnames (`db`, `redis`, `worker`, `mailhog`) to their `localhost:<host-port>` mappings from `docker-compose.yml`. Single source of truth — change a secret in `.env` and it flows through.
- The dockerized api/worker/frontend services are kept stopped while you iterate; ports 8080 and 5555 are free for the host processes to bind.
- `make dev-down` stops the infra. To go back to the fully-dockerized loop: `make up`.

When to use which:

| Workflow | Use |
|---|---|
| Frontend tweak, css/UX change | `make dev-web` — Vite HMR, instant |
| Backend logic change, route handler | `make dev-api` — restart with Ctrl+C, ~5 s rebuild |
| Migrations / new sqlx query | `make dev-migrate` then restart `make dev-api` |
| Verifying the prod-shape stack | `make up` — full docker build, slower |
| Smoke test before pushing | `make up && make smoke` — exercises the actual container surface |

## First-time setup (production)

```
git clone <this repo>
cd zerovpn
make setup                                   # copies .env.example → .env, generates secrets
$EDITOR .env                                 # see "going to production" block at the top of .env
make up-prod                                 # docker compose pull && up -d (pulls pre-built images; no MailHog)
make migrate
make bootstrap-admin EMAIL=admin@yourdomain
```

The `.env.example` header lists the eight values that must flip for prod (`ZEROVPN_ENVIRONMENT`, `ZEROVPN_DOMAIN`, `ZEROVPN_PUBLIC_URL`, `ZEROVPN_ACME_EMAIL`, `ZEROVPN_CERT_RESOLVER`, `ZEROVPN_SMTP__HOST`, `ZEROVPN_WG__BACKEND`, log levels).

`ZEROVPN_DOMAIN` must resolve to this host before `make up-prod`, or Traefik's first Let's Encrypt issuance attempt will fail. The api will also refuse to boot if `ZEROVPN_DOMAIN` is `localhost` or a `REPLACE_*` placeholder — see [validate_production_config in crates/zerovpn-api/src/main.rs](../crates/zerovpn-api/src/main.rs).

## Bringing up the real WireGuard runtime (Linux production)

The default `make up` runs the management plane only — **no actual WireGuard interface comes up**. To bring up real WG:

1. **Linux host with the WG kernel module loaded.** Verify with `lsmod | grep wireguard`. On Debian/Ubuntu:
   ```
   sudo apt install -y wireguard wireguard-tools
   sudo modprobe wireguard
   ```

2. **Set `ZEROVPN_WG__BACKEND=kernel` in `.env`.** The **api is the WireGuard host itself**: on boot it brings `wg0` up (`wg-quick`, from the DB-stored server key) in its own container netns and programs peers via the kernel netlink UAPI (`defguard_wireguard_rs`). The worker shares the api's netns to read `wg show` stats. Both hold `CAP_NET_ADMIN`; the api also gets `SYS_MODULE` + a read-only `/lib/modules` mount to load the kernel module (skip if the host preloads it with `modprobe wireguard`). There is **no separate `wg` container** and no `wg_config` volume.

3. **Bring up the stack:**
   ```
   make up-prod
   ```
   The api creates `wg0`, publishes `udp/51820`, and rewrites `wg0.conf` from the DB on every boot (nothing persists on disk). ⚠ **This prod topology has only been verified on macOS/dev (userspace boringtun); validate the kernel path on your Linux host before relying on it.**

4. **Open UDP 51820** on your firewall.

## Healthchecks

- `GET /health` — liveness (api always-on)
- `GET /ready` — db reachability
- `GET /metrics` — Prometheus-format metrics (scrape it with your own monitoring)
- `GET /openapi.json` — API schema for codegen / Swagger UI
- Traefik container healthcheck — `traefik healthcheck --ping`

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| api crashloops with `GLIBC_2.38 not found` | builder image has a newer glibc than the runtime | Dockerfile.api uses `cargo-chef:…-bookworm` to match the distroless `cc-debian12` runtime. Verify with `docker run --rm <api-image> ldd --version`. |
| `database connection refused` | DB not yet ready | `docker compose logs db`; `pg_isready` should be passing. Self-resolves once Postgres is up. |
| Frontend "API unreachable" | api container down or Traefik upstream unhealthy | `docker compose ps`, then `docker compose logs api`. |
| `wg show` empty even with profile=wg | NET_ADMIN missing or kernel module not loaded | `lsmod | grep wireguard`; `cap_add: [NET_ADMIN, SYS_MODULE]` is set on the wg service. |
| `zmq publisher bind` fails | port 5555 already used | another compose project running; `docker compose down` first. |
| Maintenance mode locks out admins | The middleware's auth-path bypass exempts `/auth/*`, `/health`, `/ready`. Admin auth still works | Sign in normally; admin role bypasses the 503. |
| `dnsmasq: failed to load /etc/dnsmasq.d/zerovpn-peers.conf` | Volume empty before first device | Harmless; the worker writes the file when the first peer's DNS name is set. |
| `wg0.conf` missing in wg container | api hasn't (re)written it from the DB yet, or the shared volume isn't writable | Restart the api — `ensure_default_server` rebuilds `wg0.conf` from `servers.private_key_encrypted` on boot. If it persists, verify the `wg_config` mount on the api service and check logs for "wg0.conf write failed". |

## Stats pipeline & disk growth

ZeroVPN runs in "every-tick kept forever" mode by default (migration 5). At each `ZEROVPN_STATS_INTERVAL_SECS` tick (default 1 second) the worker:

1. Runs `wg show <iface> dump` (or the dev simulator), computes per-peer RX/TX deltas.
2. Inserts **one row per active peer** into `bandwidth_samples`.
3. Inserts **one row per server** into `server_samples` (totals + peer/online/handshake counts).
4. Publishes `Event::StatsDelta` (peer-level, scoped to the owning user) and `Event::ServerSample` (server-level, admin-only) over ZMQ → api broadcast → WS → frontend.

**Disk growth ballpark** (each `bandwidth_samples` row is ~50 bytes including indexes, each `server_samples` row is ~70 bytes):

| Deployment | Daily rows | Daily size | 30-day | 1-year |
|---|---|---|---|---|
| 10 peers, 1 Hz | 864k | 43 MB | 1.3 GB | 16 GB |
| 50 peers, 1 Hz | 4.3M | 215 MB | 6.5 GB | 78 GB |
| 200 peers, 1 Hz | 17.3M | 860 MB | 26 GB | 314 GB |
| 50 peers, 5 Hz cadence | 17M | 860 MB | 26 GB | 314 GB |

By default raw `bandwidth_samples` and `server_samples` are purged after 30 days, so the footprint plateaus at ~30 days of ticks instead of growing without bound (aggregates are kept forever but are tiny). The table above is the *unbounded* case — what you'd see if you disable the windows. Tune via these knobs (set in `.env`):

- **Slower cadence**: `ZEROVPN_STATS_INTERVAL_SECS=5` → 5× less disk
- **Raw-sample window**: `ZEROVPN_SAMPLE_RETENTION_DAYS=N` → keep per-device samples N days (default 30; `0` = keep indefinitely, restoring the unbounded growth above)
- **Server-sample window**: `ZEROVPN_SERVER_SAMPLE_RETENTION_DAYS=N` → independent knob for `server_samples` (default 30; `0` = indefinitely)
- **Other operational tables** have matching knobs, all defaulting to 30 days with `0` = forever: `ZEROVPN_DEST_RETENTION_DAYS`, `ZEROVPN_AUDIT_RETENTION_DAYS`, `ZEROVPN_FAILED_LOGIN_RETENTION_DAYS`

Privacy note: prior to migration 5 raw samples were dropped at 7 days under the original "no-logs" posture; that has since been superseded by the full-logging policy (see CHANGELOG). Per-tick byte counters now default to a 30-day window, tunable via the knobs above (set a window to `0` to keep history indefinitely). The content guarantees still hold — no DNS query contents, no traffic payloads; what's stored is byte counts and peer/server identifiers.

**API endpoints for the historical data**:

- `GET /api/v1/devices/{id}/history?from=<rfc3339>&to=<rfc3339>&limit=3600` — raw per-tick samples for one device (owner only). Default window: last hour. Hard cap 10 000 rows.
- `GET /api/v1/servers/{id}/history?from=...&to=...&limit=...` — per-tick server samples (admin only). Same query params.
- `GET /api/v1/devices/{id}/bandwidth?range=24h|7d|30d` — rolled-up aggregates (existing endpoint, unchanged).

## Rotating secrets

```
make down
rm secrets/*.txt
rm .env                                # so init-secrets.sh re-reads the example template
cp .env.example .env
$EDITOR .env                           # re-apply any prod values (domain, SMTP, cert resolver, etc.)
./scripts/init-secrets.sh              # regenerates with new values
make up                                # or make up-prod
```

> **Caution:** rotating the session secret invalidates all live sessions; users must log in again. Rotating the KEK (`ZEROVPN_KEK`) breaks any AES-GCM-encrypted column unless you decrypt + re-encrypt with the old → new key pair first. TOTP secrets are KEK-encrypted; rotating the KEK without migration disables 2FA for everyone (they'll need to re-enroll).

## Restoration drill

> **Postgres (`pg_data`) is the single source of truth.** It holds every peer
> **and** the WG *server* private key (KEK-encrypted in `servers.private_key_encrypted`),
> so a `pg_data` restore brings the whole tunnel back — the api rewrites `wg0.conf`
> from the DB on boot and `reconcile_peers` re-adds every active peer. The
> `wg_config` volume is a **derived cache** (safe to lose; regenerated on next
> boot). So back up **`pg_data` + `secrets/` + `.env`** (`secrets/kek.txt` /
> `ZEROVPN_KEK` is required to *decrypt* the stored keys — guard it). The bundled
> nightly-backup container was removed with the observability stack, so run your
> own (a `pg_dump` cron, or a `docker run --rm -v zerovpn_pg_data:/src …` tar).

1. Stop the stack: `make down`
2. Wipe the pg_data volume: `docker volume rm zerovpn_pg_data` (the `wg_config`
   volume can be wiped too — the api rebuilds `wg0.conf` from the DB)
3. Restore the latest backup: `tar -xzf zerovpn-YYYYMMDD.tar.gz -C /tmp/restore && docker run --rm -v zerovpn_pg_data:/dst -v /tmp/restore/db:/src alpine cp -av /src/. /dst/`
4. Restore secrets: `cp -av /tmp/restore/secrets/* ./secrets/` (the KEK must match
   what encrypted the data, or the server/peer keys won't decrypt)
5. `make up` — db comes up with the restored data; the api reconstructs `wg0.conf`
   from the DB and re-adds all peers.

## Building & publishing images

App images (`api`, `worker`, `frontend`, `nflog-exporter`) are pre-built and pushed to a registry; the base `docker-compose.yml` references them by tag (`image:`), so a deploy host **pulls** them and never builds. CI does this automatically (`.github/workflows/images.yml` → GHCR on push to `main`/tags). To do it by hand:

```
docker login ghcr.io                 # or your registry
export ZEROVPN_REGISTRY=ghcr.io/<owner>  ZEROVPN_IMAGE_TAG=v1.2.3   # (also in .env)
make images                          # docker compose -f …build.yml build  (tags as $REGISTRY/zerovpn-*:$TAG)
make push                            # pushes them
```

The `build:` blocks live in `docker-compose.build.yml` (the base file is image-only). `make up` (local dev) still builds via that overlay; `make up-prod` only pulls.

## Upgrading (pull pre-built images)

```
# CI already built + pushed the new images. On the deploy host:
$EDITOR .env       # bump ZEROVPN_IMAGE_TAG to the new version (or keep :latest)
make up-prod       # docker compose pull && up -d  — pulls the new images
make migrate       # applies any new migrations
```

For zero-downtime upgrades, drain peers off this server first by toggling **maintenance mode** in the admin UI, then `docker compose pull api worker frontend && docker compose up -d --no-deps api worker frontend`.

## Security review checklist (before exposing to the internet)

- [ ] Brought up via `make up-prod` (not `make up`) — `make up-prod` omits the `dev` profile so MailHog never comes up
- [ ] `ZEROVPN_ENVIRONMENT=production` in `.env`; the api refuses to boot otherwise
- [ ] `ZEROVPN_KEK` is a fresh 32-byte base64 random, distinct from any value previously used in dev (the prod boot check rejects `CHANGEME` and short values; rotate via the "Rotating secrets" section before exposing publicly)
- [ ] `ZEROVPN_DOMAIN` set to a real domain that already resolves to this host (LE issuance otherwise fails on first boot)
- [ ] `ZEROVPN_ACME_EMAIL` set so Let's Encrypt can contact you on rate-limit / expiry
- [ ] `ZEROVPN_CERT_RESOLVER=le` so Traefik provisions LE certs against the real domain
- [ ] `ZEROVPN_SMTP__HOST` is a real relay (not `mailhog`); api refuses to boot with placeholders
- [ ] Firewall: 22/tcp (SSH), 80/tcp (Traefik redirect), 443/tcp (Traefik HTTPS), 51820/udp (WireGuard) — nothing else
- [ ] `secrets/*.txt` mode 0600, `.env` mode 0600 and not in git (`git check-ignore .env` should print the file)
- [ ] Admin email/password rotated from the bootstrap default
- [ ] Off-box backups of `pg_data` + `secrets/` + `.env` configured (the KEK decrypts the server **and** peer keys stored in `pg_data`; `wg_config` is a derived cache and need not be backed up) + verify a restore drill before relying on it
- [ ] `ZEROVPN_WG__BACKEND=kernel` and the host WG kernel module loaded — the api brings up `wg0` itself (no separate `wg` container). Note the api runs privileged (`NET_ADMIN`) as a result

## Container hardening notes (1C)

- api / worker: `read_only: true`, `tmpfs: /tmp`, `cap_drop: [ALL]`, `no-new-privileges`. Distroless non-root.
- traefik: `cap_drop: [ALL]`, `cap_add: [NET_BIND_SERVICE]`, `no-new-privileges`.
- frontend (nginx): `cap_drop: [ALL]`, `cap_add: [CHOWN, SETUID, SETGID, NET_BIND_SERVICE]`, tmpfs for `/var/cache/nginx` + `/var/run`.
- db / redis: untouched (need full FS access for their data dirs).
- wg: needs `NET_ADMIN, SYS_MODULE` for the kernel module + `host` networking; no further hardening.
