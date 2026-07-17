# ZeroVPN

Self-hosted WireGuard VPN management platform. Rust backend + React frontend, single `docker compose up -d` to run, designed to be lightweight (1 GB / 1 vCPU baseline). Operators retain full operational logs (account events, sign-ins, per-device handshake metadata, WG peer endpoints) for admin visibility — no traffic content / DNS / destination logging. See [CHANGELOG.md](CHANGELOG.md) → "Policy reversal — full logging system" for the retention model.

## Status

See [CHANGELOG.md](CHANGELOG.md) for current state.

## Quickstart (dev)

```bash
make setup     # one-time: copies .env.example → .env, generates dev secrets, builds images
make up        # start the dev stack locally (core + MailHog)
make logs      # tail logs
make migrate   # run pending DB migrations
make bootstrap-admin EMAIL=admin@example.com   # create the first admin (will prompt for password)
make down      # stop everything
make clean     # nuke volumes (destructive)
```

After `make up`:
- Web UI: <https://localhost> (Traefik's self-signed cert in dev)
- MailHog: <http://localhost:8025>

## Quickstart (production)

The app images are **built + pushed to a registry** (CI does this on push to `main`/tags — see `.github/workflows/images.yml`), and the deploy host **pulls** them (never builds):

```bash
# Build + push images (CI, or locally after `docker login`):
make images && make push           # -> $ZEROVPN_REGISTRY/zerovpn-*:$ZEROVPN_IMAGE_TAG

# On the deploy host:
make setup                         # copies .env.example → .env, generates secrets
$EDITOR .env                       # prod values + ZEROVPN_REGISTRY / ZEROVPN_IMAGE_TAG
make up-prod                       # pulls the pre-built images, starts the stack (no `dev` profile)
make migrate
make bootstrap-admin EMAIL=admin@your-domain
```

Production differs from dev only in `.env`: `ZEROVPN_ENVIRONMENT=production`, real `ZEROVPN_DOMAIN`, real SMTP relay, `ZEROVPN_CERT_RESOLVER=le` (Traefik + Let's Encrypt), plus `ZEROVPN_REGISTRY`/`ZEROVPN_IMAGE_TAG`. (WireGuard runs userspace — no host setup.) `make up-prod` uses the base compose alone (no `docker-compose.mail.yml`), so MailHog never comes up. The api refuses to boot in production with `CHANGEME` secrets or a placeholder domain. See [docs/runbook.md](docs/runbook.md#dev-vs-prod-isolation) for the full table.

## Architecture

See [docs/architecture.md](docs/architecture.md). High-level: Rust workspace with multiple crates (api, worker, wg, dns, events, etc.), PostgreSQL 18, WireGuard for the tunnel (userspace boringtun, hosted by the api itself), dnsmasq for per-peer DNS, Traefik as reverse proxy. Internal pub/sub via ZeroMQ; browser receives over WebSocket. Wire format: MessagePack over a shared Rust wire schema mirrored in TypeScript on the frontend.

## Project layout

```
.
├── crates/                        # Rust workspace
│   ├── zerovpn-core/              # domain types
│   ├── zerovpn-db/                # sqlx queries
│   ├── zerovpn-wg/                # WireGuard control
│   ├── zerovpn-auth/              # password, sessions, TOTP
│   ├── zerovpn-events/            # ZeroMQ pub/sub
│   ├── zerovpn-wire/              # shared wire schema
│   ├── zerovpn-dns/               # dnsmasq hosts file writer
│   ├── zerovpn-mail/              # SMTP via lettre
│   ├── zerovpn-api/               # Axum HTTP+WS binary
│   ├── zerovpn-worker/            # poller + aggregator + retention + apalis jobs
│   └── zerovpn-cli/               # admin CLI
├── migrations/                    # sqlx migrations
├── web/                           # React + Vite frontend
├── deploy/                        # Dockerfiles, compose, Traefik config
├── docs/                          # architecture, runbook, api
├── scripts/                       # dev helpers
├── Cargo.toml                     # workspace
├── Makefile
├── docker-compose.yml
├── .env.example
├── CHANGELOG.md
└── README.md
```

## License

Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) — see [LICENSE](LICENSE).
