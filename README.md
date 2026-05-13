# ZeroVPN

Self-hosted WireGuard VPN management platform. Rust backend + React frontend, single `docker compose up -d` to run, designed to be lightweight (1 GB / 1 vCPU baseline). Operators retain full operational logs (account events, sign-ins, per-device handshake metadata, WG peer endpoints) for admin visibility — no traffic content / DNS / destination logging. See [CHANGELOG.md](CHANGELOG.md) → "Policy reversal — full logging system" for the retention model.

## Status

Phase 1A (foundation). See [TODO.md](TODO.md) and [CHANGELOG.md](CHANGELOG.md) for current state.

## Quickstart (dev)

```bash
make setup     # one-time: copies .env.dev.example → .env.dev, generates dev secrets, builds images
make up        # start the dev stack
make logs      # tail logs
make migrate   # run pending DB migrations
make bootstrap-admin EMAIL=admin@example.com   # create the first admin (will prompt for password)
make down      # stop everything
make clean     # nuke volumes (destructive)
```

After `make up`:
- Web UI: <https://localhost> (self-signed cert from Caddy's local CA)
- MailHog: <http://localhost:8025>
- Grafana (with observability profile): <https://localhost/grafana>

## Quickstart (production)

```bash
make setup-prod                                  # copies .env.prod.example → .env.prod
$EDITOR .env.prod                                # fill in ZEROVPN_DOMAIN, SMTP relay
./scripts/init-secrets.sh prod                   # generates random secrets
make up-prod                                     # starts the prod stack
make migrate ENV=prod
make bootstrap-admin EMAIL=admin@your-domain ENV=prod
```

Production differs from dev in: real Let's Encrypt TLS against `ZEROVPN_DOMAIN`, no exposed internal ports, no MailHog, separate `.env.prod` + `secrets/prod/` so dev secrets never leak in. The api refuses to boot in production with `CHANGEME` secrets or a placeholder domain. See [docs/runbook.md](docs/runbook.md#dev-vs-prod-isolation) for the full table.

## Architecture

See [docs/architecture.md](docs/architecture.md). High-level: Rust workspace with multiple crates (api, worker, wg, dns, events, etc.), PostgreSQL 18, Redis 8, AmneziaWG-go for the tunnel, dnsmasq for per-peer DNS, Caddy as reverse proxy. Internal pub/sub via ZeroMQ; browser receives over WebSocket. Wire format: MessagePack via a shared Rust crate compiled to WASM for the frontend.

## Project layout

```
.
├── crates/                        # Rust workspace
│   ├── zerovpn-core/              # domain types
│   ├── zerovpn-db/                # sqlx queries
│   ├── zerovpn-wg/                # WireGuard control
│   ├── zerovpn-obfs/              # AmneziaWG params
│   ├── zerovpn-auth/              # password, sessions, TOTP, API tokens
│   ├── zerovpn-stats/             # poller + aggregator + retention
│   ├── zerovpn-events/            # ZeroMQ pub/sub
│   ├── zerovpn-wire/              # shared wire schema (also compiles to WASM)
│   ├── zerovpn-dns/               # dnsmasq hosts file writer
│   ├── zerovpn-mail/              # SMTP via lettre
│   ├── zerovpn-api/               # Axum HTTP+WS binary
│   ├── zerovpn-worker/            # apalis worker binary
│   ├── zerovpn-cli/               # admin CLI
│   └── zerovpn-topology/          # WASM force-layout for admin scale view
├── migrations/                    # sqlx migrations
├── web/                           # React + Vite frontend
├── deploy/                        # Dockerfiles, compose, Caddyfile
├── docs/                          # architecture, runbook, api
├── scripts/                       # dev helpers
├── Cargo.toml                     # workspace
├── Makefile
├── docker-compose.yml
├── docker-compose.dev.yml
├── CHANGELOG.md
├── TODO.md
└── README.md
```

## License

TBD (recommendation: AGPL-3.0 to keep self-hosted forks open).
