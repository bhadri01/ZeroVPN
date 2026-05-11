# Architecture (condensed)

Full design rationale lives in [`/Users/black/.claude/plans/can-u-list-out-memoized-matsumoto.md`](../.. /). This file is the reference that lives with the code.

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
- Time-series `bandwidth_samples` partitioned monthly with `RANGE` partitions. **Raw rows kept indefinitely by default** (migration 5); set `ZEROVPN_SAMPLE_RETENTION_DAYS=N` to bring back a hard window. Aggregates (`bandwidth_aggregates`) are unbounded regardless. See [runbook.md → Stats pipeline & disk growth](runbook.md#stats-pipeline--disk-growth) for the storage math.
- Per-server time-series `server_samples` (migration 5) tracks total RX/TX, peer counts, and handshake-rate per poll tick. Same partitioning + retention story as `bandwidth_samples`, gated on `ZEROVPN_SERVER_SAMPLE_RETENTION_DAYS`.

## Privacy & no-logs

- IPs are stored as INET prefixes (`/24` for IPv4, `/48` for IPv6). User agents as sha256 hashes only.
- No DNS query logs, no traffic content, no destination IP logs anywhere in the stack.
- The retention purger anonymizes audit metadata after policy windows (30 days for IPs) and hard-purges soft-deleted users at +30 days.
- **Per-tick byte counters (`bandwidth_samples`, `server_samples`) are kept indefinitely by default** as of migration 5. This is a relaxation of the original "raw rows dropped at 7 days" posture. The traffic-content guarantees above still hold — what's logged is byte counts and peer/server identifiers, not destinations, not payloads. If the relaxation isn't what you want, set `ZEROVPN_SAMPLE_RETENTION_DAYS` + `ZEROVPN_SERVER_SAMPLE_RETENTION_DAYS` to restore the bounded-window behavior.

## Obfuscation

- Per-peer randomized AmneziaWG params (`Sc/Sr/H1–H4/Jc/Jmin/Jmax/S1/S2`) are generated on device creation and embedded in the `.conf` download. Vanilla WG clients won't connect — users get an AmneziaWG-aware client (linked from setup guides).
- wstunnel (escape-hatch transport for UDP-blocked networks) is deferred to v1.1.
