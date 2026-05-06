# ZeroVPN

Self-hosted WireGuard VPN management platform. Rust backend + React frontend, single `docker compose up -d` to run, designed to be lightweight (1 GB / 1 vCPU baseline) and privacy-first (no-logs).

## Status

Phase 1A (foundation). See [TODO.md](TODO.md) and [CHANGELOG.md](CHANGELOG.md) for current state.

## Quickstart

```bash
make setup     # one-time: copies .env.example, generates secrets, builds images
make up        # start the full stack
make logs      # tail logs
make migrate   # run pending DB migrations
make bootstrap-admin EMAIL=admin@example.com   # create the first admin (will prompt for password)
make down      # stop everything
make clean     # nuke volumes (destructive)
```

After `make up`:
- Web UI: <https://localhost> (self-signed cert in dev; LE in prod)
- MailHog (dev only): <http://localhost:8025>
- Grafana (Phase 1C): <https://localhost/grafana>

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
