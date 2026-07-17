# Architecture (condensed)

This file is the reference that lives with the code.

## High-level

```
                            Internet
                               │
        ┌──────────────────────┼─────────────────────┐
        │ TCP 80/443           │ UDP 51820           │
        ▼                      ▼                     │
   ┌─────────┐           ┌─────────┐    ┌─────────┐  │
   │  caddy  │           │   wg    │───▶│ dnsmasq │  │
   │ (proxy) │           │(host-net│    │ (peer   │  │
   └────┬────┘           │ NET_ADM)│    │  DNS)   │  │
        │                └────┬────┘    └─────────┘  │
        │ /api/* /ws/*        │                      │
        ▼                     │ wg show              │
   ┌─────────┐                │                      │
   │   api   │◀───ZMQ SUB─────┤                      │
   │ (Axum)  │  tcp://worker:5555                    │
   │  + WS   │                ▼                      │
   └────┬────┘          ┌──────────┐                 │
        │               │  worker  │ poller (30s)    │
        │               │ (apalis  │ rollups         │
        │               │ + ZMQ    │ retention       │
        │               │   PUB)   │ email           │
        │               └────┬─────┘                 │
        ▼                    │                       │
   ┌──────────┐         ┌────▼─────┐  ┌─────────┐    │
   │ frontend │         │    db    │  │  redis  │    │
   │ (nginx)  │         │(Postgres)│  │ (cache, │    │
   │  React   │         └──────────┘  │  rate-  │    │
   └──────────┘                       │  limit) │    │
                                      └─────────┘    │
```

## Process model

- **api** (binary `zerovpn-api`): HTTP + WebSocket, Axum 0.8. Reads/writes the DB, subscribes to ZMQ for live data, fans out to connected WS clients. Serves OpenAPI spec.
- **worker** (binary `zerovpn-worker`): runs the WG poller (30 s), bandwidth aggregator (apalis cron), retention purger, email sender, and binds the ZMQ PUB socket on `tcp://0.0.0.0:5555`.
- **cli** (binary `zerovpn-cli`): admin tool — migrate DB, bootstrap admin, rotate keys.

## Data flow: live stats → browser

1. Worker's `wg show dump` poll computes per-peer RX/TX deltas every 30 s.
2. Each delta is encoded as MessagePack (`zerovpn-wire::Event::StatsDelta`) and published on ZMQ topic `stats.peer.<uuid>`.
3. The api process subscribes (`stats.*`, `events.*`) and converts received events into `tokio::sync::broadcast` messages keyed by user.
4. WebSocket handlers (one per browser tab) filter the broadcast to events relevant to the authenticated user, encode them into MessagePack frames, and send them over the WS connection.
5. The browser deserializes via `@msgpack/msgpack` (or, on hot paths, the `zerovpn-wire` WASM module — same Rust types, same wire format, decoded ~3× faster).
6. The topology graph and live-rate widgets consume those decoded events.

## Persistence

- PostgreSQL 18, single primary. Connection pooling via sqlx (16 max in api, 4 in worker).
- Time-series `bandwidth_samples` partitioned monthly with `RANGE` partitions. **Raw rows are purged after 30 days by default**; override with `ZEROVPN_SAMPLE_RETENTION_DAYS=N` (set `N=0` to keep them indefinitely). Aggregates (`bandwidth_aggregates`) are unbounded regardless. See [runbook.md → Stats pipeline & disk growth](runbook.md#stats-pipeline--disk-growth) for the storage math.
- Per-server time-series `server_samples` (migration 5) tracks total RX/TX, peer counts, and handshake-rate per poll tick. Same partitioning + retention story as `bandwidth_samples`, with its own knob `ZEROVPN_SERVER_SAMPLE_RETENTION_DAYS` (default 30 days; `0` = keep indefinitely).

## Logging & privacy

The "no-logs" posture was deliberately reversed — ZeroVPN now retains full
operational logs for admin visibility. See CHANGELOG → "Policy reversal —
full logging system" for the decision record. Concretely:

- Full client IPs and User-Agent strings are captured on auth flows (no longer prefix-truncated or hashed), alongside account events, per-device handshake metadata, and WG peer endpoints — all surfaced to admins.
- Flow metadata (`destination_ips`, sourced from conntrack) backs the Topology → Flows view.
- Still **not** captured anywhere in the stack: traffic content / payloads and DNS query contents.
- Each operational table is purged on its own window — 30 days by default for `bandwidth_samples`, `server_samples`, `destination_ips`, `audit_logs`, and `failed_logins` — overridable per table via the `ZEROVPN_*_RETENTION_DAYS` env vars (set a var to `0` to keep that table forever; e.g. `ZEROVPN_AUDIT_RETENTION_DAYS=0` for an unbounded audit trail). Soft-deleted users are hard-purged at +30 days.

## Obfuscation

- Device `.conf` downloads are vanilla WireGuard, which the official WireGuard clients accept and which matches the default `linuxserver/wireguard` server runtime.
- wstunnel (escape-hatch transport for UDP-blocked networks) is deferred to v1.1.
