# Stage C: Destination IP Capture Infrastructure

## Overview

The destination IP capture pipeline allows ZeroVPN to log and analyze destination IP traffic patterns. This is done via a multi-component architecture:

1. **Database** (`destination_ips` table) — stores flows
2. **Worker ingest** (`crates/zerovpn-worker/destination_ingest`) — TCP/JSON listener
3. **Exporter** (`scripts/ulogd-exporter.py`) — transforms ulogd2 JSON → flow format
4. **Docker compose** — orchestrates the pipeline

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ WireGuard Container (netns)                                 │
│  • netfilter NFLOG target logs packets to kernel NFLOG queue│
└─────────────────┬───────────────────────────────────────────┘
                  │ (kernel netfilter events)
                  ↓
┌──────────────────────────────────────────────────────────────┐
│ ulogd2 (future)                                              │
│  • Reads NFLOG events (group 100)                           │
│  • Emits JSON to stdout                                     │
└──────────────────┬─────────────────────────────────────────┘
                  │ (JSON flow events)
                  ↓
┌──────────────────────────────────────────────────────────────┐
│ ulogd-exporter (Python)                                      │
│  • Reads JSON from stdin / socket                           │
│  • Transforms to flow format                                │
│  • Sends to worker ingest TCP port (9898)                   │
└──────────────────┬─────────────────────────────────────────┘
                  │ (JSON lines over TCP)
                  ↓
┌──────────────────────────────────────────────────────────────┐
│ zerovpn-worker (destination_ingest)                          │
│  • Listens on 0.0.0.0:9898 (ZEROVPN_INGEST__DEST_BIND)      │
│  • Resolves src_ip → device_id / user_id                    │
│  • Persists to destination_ips table                         │
└──────────────────┬─────────────────────────────────────────┘
                  │
                  ↓
           PostgreSQL (destination_ips)
```

## Running the Pipeline

### Development / Testing

1. **Start the worker with ingest enabled:**

```bash
docker compose up -d
```

The worker automatically binds the ingest endpoint on `0.0.0.0:9898` inside the container (port `9898` on the host).

2. **Send test flow events:**

```bash
# Example: UDP DNS query from device IP to 8.8.8.8
echo '{"src_ip":"10.0.0.5","dst_ip":"8.8.8.8","dst_port":53,"proto":"udp","bytes_in":100,"bytes_out":50}' | nc localhost 9898
```

3. **Query the database:**

```bash
# Connect to the database and view flows
docker compose exec db psql -U zerovpn -d zerovpn -c "SELECT src_ip, dst_ip, dst_port, proto, bytes_in FROM destination_ips ORDER BY created_at DESC LIMIT 10;"
```

### Production (with real NFLOG data)

1. **Enable the exporter service:**

```bash
docker compose --profile ingest up -d
```

2. **Configure netfilter rules in the WG container:**

Inside the WG container's netns, add NFLOG rules to capture destination traffic:

```bash
# Log all outbound traffic to NFLOG group 100
iptables -A FORWARD -j NFLOG --nflog-group 100 --nflog-prefix "DST:"
```

3. **Start ulogd2:**

The ulogd2 container (when integrated) will:
- Read NFLOG events from group 100
- Emit JSON to its stdout (captured by Docker logs)
- Pipe output to the exporter

4. **Verify pipeline:**

```bash
# Check worker ingest is receiving data
docker compose logs -f worker | grep "destination_ips"

# Verify database persistence
docker compose exec db psql -U zerovpn -d zerovpn -c "SELECT COUNT(*) FROM destination_ips;"
```

## Environment Variables

- `ZEROVPN_INGEST__DEST_BIND` — TCP bind address for worker ingest (default: `0.0.0.0:9898`)
- `INGEST_ENDPOINT` — Worker ingest endpoint as seen from exporter container (default: `localhost:9898`)

## Flow Event Format

JSON lines sent to the ingest endpoint must match:

```json
{
  "src_ip": "10.0.0.5",
  "src_port": 54321,
  "dst_ip": "8.8.8.8",
  "dst_port": 443,
  "proto": "tcp",
  "bytes_in": 1024,
  "bytes_out": 512,
  "started_at": "2026-05-14T12:34:56Z"
}
```

All fields except `src_ip` and `dst_ip` are optional. The ingest handler:
- Queries `allocated_ip` in the `devices` table to map `src_ip` → `device_id` / `user_id`
- Stores the record with `device_id` / `user_id` as `NULL` if no mapping is found
- Persists to `destination_ips` table

## Testing the Pipeline (Standalone)

Run the integration test:

```bash
bash scripts/test-stage-c.sh
```

This validates:
- All migration files present
- All repo modules compiled
- All exporter scripts syntactically correct
- Docker compose config valid

## Future Enhancements

1. **Real NFLOG integration:** Deploy ulogd2 container reading from kernel NFLOG
2. **Geo enrichment:** Resolve `dst_ip` to GeoIP coordinates + country (MaxMind)
3. **Admin UI:** Per-device traffic explorer with date-range filters and heatmaps
4. **Retention policies:** Configurable per-table retention windows in `app_settings`
5. **Compliance logging:** Audit who reads the logs (Stage D)
