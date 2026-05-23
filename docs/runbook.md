# Runbook

## Dev vs. prod isolation

ZeroVPN ships a single `docker-compose.yml` + single `.env`. Dev vs. prod is driven by `.env` values; optional service groups (MailHog, observability stack, WG, ingest) come up via compose **profiles**:

| | dev | prod |
|---|---|---|
| Compose invocation | `docker compose --profile dev up -d` (via `make up`) | `docker compose up -d` (via `make up-prod`) |
| Env file | `.env` (from `.env.example`) — `ZEROVPN_ENVIRONMENT=dev` | `.env` (same file, edited) — `ZEROVPN_ENVIRONMENT=production` |
| Caddyfile | `deploy/Caddyfile.dev` (`ZEROVPN_CADDYFILE` defaults here) | `deploy/Caddyfile.prod` (set in `.env`) |
| Exposed host ports | 80, 443, 51820/udp + loopback-only 18080/5555/55432/56379 + 8025 (MailHog via `dev` profile) | 80, 443, 51820/udp + loopback-only 18080/5555/55432/56379 (no MailHog) |
| Mailer | MailHog (via `dev` profile) | real SMTP relay (set `ZEROVPN_SMTP__HOST` in `.env`) |
| WG backend | `noop` | `kernel` (set in `.env`; requires `--profile wg`) |
| Session cookie | not Secure (plaintext localhost) | Secure flag set (api enforces when `ZEROVPN_ENVIRONMENT=production`) |

Compose profiles compose: `--profile dev --profile observability` enables both.

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

`make up` runs everything in docker — fine for verifying the prod-shape build, but slow when iterating on code (every change = `docker compose build`). For fast iteration, run only the *infrastructure* (db, redis, mailhog, dnsmasq) in docker and run `api` / `worker` / `frontend` natively. Frontend gets Vite HMR (<100 ms); backend uses cargo's incremental compile (~3–10 s after a small change).

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
make up-prod                                 # docker compose up -d (no `dev` profile, so no MailHog)
make migrate
make bootstrap-admin EMAIL=admin@yourdomain
```

The `.env.example` header lists the eight values that must flip for prod (`ZEROVPN_ENVIRONMENT`, `ZEROVPN_DOMAIN`, `ZEROVPN_PUBLIC_URL`, `ZEROVPN_ACME_EMAIL`, `ZEROVPN_CADDYFILE`, `ZEROVPN_SMTP__HOST`, `ZEROVPN_WG__BACKEND`, log levels).

`ZEROVPN_DOMAIN` must resolve to this host before `make up-prod`, or Caddy's first Let's Encrypt issuance attempt will fail. The api will also refuse to boot if `ZEROVPN_DOMAIN` is `localhost` or a `REPLACE_*` placeholder — see [validate_production_config in crates/zerovpn-api/src/main.rs](../crates/zerovpn-api/src/main.rs).

## Bringing up the real WireGuard runtime (Linux production)

The default `make up` runs the management plane only — **no actual WireGuard interface comes up**. To bring up real WG:

1. **Linux host with the WG kernel module loaded.** Verify with `lsmod | grep wireguard`. On Debian/Ubuntu:
   ```
   sudo apt install -y wireguard wireguard-tools
   sudo modprobe wireguard
   ```

2. **Set `ZEROVPN_WG__BACKEND=kernel` in `.env`.** The api/worker drive peers directly via the kernel WireGuard netlink UAPI through `defguard_wireguard_rs` — no `wg` binary on the host, no `nsenter` shell hop. The legacy `shell` backend that shells out to `wg set` is still available for environments where netlink isn't reachable. Either way, the container running the controller needs `CAP_NET_ADMIN` and visibility of the WG interface's netns.

3. **Bring up the wg container alongside the rest of the stack:**
   ```
   docker compose --profile wg up -d
   ```
   The bootstrap routine writes `wg0.conf` into the shared `wg_config` volume on first boot; the wg container picks it up and runs `wg-quick up wg0`.

4. **Open UDP 51820** on your firewall.

5. **AmneziaWG obfuscation** (optional but recommended for restrictive networks): swap the `wg` service image from `linuxserver/wireguard:latest` to an AmneziaWG-compatible build (e.g. `ghcr.io/amnezia-vpn/amneziawg-go:latest`) and add the `Jc/Jmin/Jmax/H1–H4/S1–S2` lines to peer configs (already emitted by the `.conf` template).

## Bringing up observability

```
docker compose --profile observability up -d
# or alongside dev: docker compose --profile dev --profile observability up -d
```

Adds Prometheus (scraping `api:8080/metrics` every 15 s), Grafana with the Prometheus + Loki datasources pre-provisioned (admin/admin at <http://localhost/grafana/>), Loki + Promtail for centralized container logs, and a nightly backup container.

For age-encrypted backups, set `ZEROVPN_BACKUP_AGE_RECIPIENT` to your age public key in `.env` before bringing up the profile.

## Healthchecks

- `GET /health` — liveness (api always-on)
- `GET /ready` — db reachability
- `GET /metrics` — Prometheus exposition
- `GET /openapi.json` — API schema for codegen / Swagger UI
- Caddy `/healthz` — proxy responsive

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| api crashloops with `GLIBC_2.38 not found` | builder image has a newer glibc than the runtime | Dockerfile.api uses `cargo-chef:…-bookworm` to match the distroless `cc-debian12` runtime. Verify with `docker run --rm <api-image> ldd --version`. |
| `database connection refused` | DB not yet ready | `docker compose logs db`; `pg_isready` should be passing. Self-resolves once Postgres is up. |
| Frontend "API unreachable" | api container down or Caddy upstream unhealthy | `docker compose ps`, then `docker compose logs api`. |
| `wg show` empty even with profile=wg | NET_ADMIN missing or kernel module not loaded | `lsmod | grep wireguard`; `cap_add: [NET_ADMIN, SYS_MODULE]` is set on the wg service. |
| `zmq publisher bind` fails | port 5555 already used | another compose project running; `docker compose down` first. |
| Maintenance mode locks out admins | The middleware's auth-path bypass exempts `/auth/*`, `/health`, `/ready`. Admin auth still works | Sign in normally; admin role bypasses the 503. |
| `dnsmasq: failed to load /etc/dnsmasq.d/zerovpn-peers.conf` | Volume empty before first device | Harmless; the worker writes the file when the first peer's DNS name is set. |
| `wg0.conf` missing in wg container | Bootstrap couldn't write to shared volume | Verify `wg_config` volume mount on api service; check api logs for "wg0.conf write failed". |

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

If that's too much, dial back via one of these knobs (set in `.env`):

- **Slower cadence**: `ZEROVPN_STATS_INTERVAL_SECS=5` → 5× less disk
- **Raw-sample window**: `ZEROVPN_SAMPLE_RETENTION_DAYS=30` → drop per-device samples after 30 days (aggregates still kept forever, so long-term charts unaffected)
- **Server-sample window**: `ZEROVPN_SERVER_SAMPLE_RETENTION_DAYS=90` → independent knob for `server_samples`

Privacy note: prior to migration 5 the system was explicitly "no-logs" (raw samples dropped at 7 days). The current default keeps per-tick history indefinitely, which is a non-trivial change in posture. The retention env vars above let you restore the original behavior in one line. The previously-documented privacy guarantees (no DNS query logs, no traffic content, no destination IPs) still hold — what changed is how long the byte-count time-series is kept.

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
$EDITOR .env                           # re-apply any prod values (domain, SMTP, Caddyfile, etc.)
./scripts/init-secrets.sh              # regenerates with new values
make up                                # or make up-prod
```

> **Caution:** rotating the session secret invalidates all live sessions; users must log in again. Rotating the KEK (`ZEROVPN_KEK`) breaks any AES-GCM-encrypted column unless you decrypt + re-encrypt with the old → new key pair first. TOTP secrets are KEK-encrypted; rotating the KEK without migration disables 2FA for everyone (they'll need to re-enroll).

## Restoration drill

1. Stop the stack: `make down`
2. Wipe the pg_data volume: `docker volume rm zerovpn_pg_data`
3. Restore the latest backup: `tar -xzf zerovpn-YYYYMMDD.tar.gz -C /tmp/restore && docker run --rm -v zerovpn_pg_data:/dst -v /tmp/restore/db:/src alpine cp -av /src/. /dst/`
4. Restore secrets: `cp -av /tmp/restore/secrets/* ./secrets/`
5. `make up` — db should come up healthy with the restored data.

## Upgrading

```
git pull
make check         # cargo check + clippy + tsc + eslint
docker compose build
make migrate       # applies any new migrations
make up
```

For zero-downtime upgrades, drain peers off this server first by toggling **maintenance mode** in the admin UI, then `docker compose up -d --no-deps api worker frontend`.

## Switching the WG image to AmneziaWG

The default `linuxserver/wireguard` image is fine for vanilla WireGuard. For AmneziaWG (obfuscated WireGuard variant the `.conf` template already emits params for):

1. Replace the image in `docker-compose.yml` under the `wg` service: `image: ghcr.io/amnezia-vpn/amneziawg-go:latest` (or the kernel-module variant if your host has the kernel patches).
2. Rebuild: `docker compose --profile wg up -d --force-recreate wg`
3. The Sc/Sr/H1–H4/Jc/Jmin/Jmax/S1/S2 fields the api emits in `[Interface]` are AmneziaWG-only; standard WG clients ignore them.
4. Clients need an AmneziaWG-aware app (the standard WireGuard apps won't connect).

## Security review checklist (before exposing to the internet)

- [ ] Brought up via `make up-prod` (not `make up`) — `make up-prod` omits the `dev` profile so MailHog never comes up
- [ ] `ZEROVPN_ENVIRONMENT=production` in `.env`; the api refuses to boot otherwise
- [ ] `ZEROVPN_KEK` is a fresh 32-byte base64 random, distinct from any value previously used in dev (the prod boot check rejects `CHANGEME` and short values; rotate via the "Rotating secrets" section before exposing publicly)
- [ ] `ZEROVPN_DOMAIN` set to a real domain that already resolves to this host (LE issuance otherwise fails on first boot)
- [ ] `ZEROVPN_ACME_EMAIL` set so Let's Encrypt can contact you on rate-limit / expiry
- [ ] `ZEROVPN_CADDYFILE=./deploy/Caddyfile.prod` so Caddy provisions LE certs against the real domain
- [ ] `ZEROVPN_SMTP__HOST` is a real relay (not `mailhog`); api refuses to boot with placeholders
- [ ] Firewall: 22/tcp (SSH), 80/tcp (Caddy redirect), 443/tcp+udp (Caddy + HTTP/3), 51820/udp (WireGuard) — nothing else
- [ ] `secrets/*.txt` mode 0600, `.env` mode 0600 and not in git (`git check-ignore .env` should print the file)
- [ ] Admin email/password rotated from the bootstrap default
- [ ] Backup `AGE_RECIPIENT` configured + verify a restore drill before relying on it
- [ ] `ZEROVPN_WG__BACKEND=kernel` (or `shell` for legacy `wg`-binary deployments) and `docker compose --profile wg up -d` to actually route packets

## Container hardening notes (1C)

- api / worker: `read_only: true`, `tmpfs: /tmp`, `cap_drop: [ALL]`, `no-new-privileges`. Distroless non-root.
- caddy: `cap_drop: [ALL]`, `cap_add: [NET_BIND_SERVICE]`.
- frontend (nginx): `cap_drop: [ALL]`, `cap_add: [CHOWN, SETUID, SETGID, NET_BIND_SERVICE]`, tmpfs for `/var/cache/nginx` + `/var/run`.
- db / redis: untouched (need full FS access for their data dirs).
- wg: needs `NET_ADMIN, SYS_MODULE` for the kernel module + `host` networking; no further hardening.
