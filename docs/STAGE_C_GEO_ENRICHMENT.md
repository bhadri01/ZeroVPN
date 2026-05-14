# Geo Enrichment for Destination IP Capture

## Overview

The destination IP capture pipeline now includes **optional geographic enrichment** via MaxMind GeoLite2 database lookups. When enabled, each captured flow is enriched with:

- **Latitude / Longitude** — pinpoint destination location on maps/heatmaps
- **Country Code** — 2-letter ISO country code (e.g., "US", "DE", "JP")
- **Country Name** — full country name
- **City Name** — city-level location (when available)

Geo enrichment happens **at write time** (during ingest) and is **best-effort**: if the database lookup fails or the IP is not found (private ranges, reserved addresses), the row is persisted with `NULL` geo fields.

## Architecture

```
Worker ingest (destination_ingest.rs)
    ↓
  Load GeoReader from $ZEROVPN_GEO_DB_PATH (if set)
    ↓
  For each flow event:
    • Resolve device_id/user_id by src_ip (as before)
    • Look up dst_ip in GeoLite2 database
    • Extract: latitude, longitude, country_code, country_name, city_name
    ↓
  Insert to destination_ips with geo fields (all optional)
    ↓
  Database (destination_ips table)
    • Geo columns: NULL if lookup failed
    • Indexes on country_code, city_name for heatmap queries
```

## Setup

### 1. Download GeoLite2 Database

Get the free **GeoLite2-City** database from MaxMind:

```bash
# Visit: https://www.maxmind.com/en/geolite2/signup
# Sign up, download GeoLite2-City.mmdb
# Save to a persistent location (e.g., /opt/zerovpn/geoip/GeoLite2-City.mmdb)
```

### 2. Configure Worker Environment Variable

Set `ZEROVPN_GEO_DB_PATH` to point to the database file:

```bash
# .env.worker
export ZEROVPN_GEO_DB_PATH="/opt/zerovpn/geoip/GeoLite2-City.mmdb"
```

Or in `docker-compose.yml`:

```yaml
services:
  worker:
    environment:
      ZEROVPN_GEO_DB_PATH: "/data/geoip/GeoLite2-City.mmdb"
    volumes:
      - ./geoip:/data/geoip:ro  # Mount database read-only
```

### 3. Run the Pipeline

```bash
# Start the worker with ingest + geo enabled
docker compose up -d worker

# Verify it loaded the database
docker compose logs worker | grep "loaded GeoIP database"
```

If the environment variable is not set or the database file is not found, the worker continues normally without geo enrichment (graceful degradation).

## Testing

### Send a flow event and verify geo enrichment:

```bash
# Example: flow from device to Google DNS (8.8.8.8 = Mountain View, CA, USA)
echo '{"src_ip":"10.0.0.5","dst_ip":"8.8.8.8","dst_port":53,"proto":"udp","bytes_in":100,"bytes_out":50}' | nc localhost 9898

# Query the database
docker compose exec db psql -U zerovpn -d zerovpn -c "
  SELECT dst_ip, country_code, country_name, city_name, latitude, longitude
  FROM destination_ips
  WHERE dst_ip = '8.8.8.8'
  ORDER BY created_at DESC LIMIT 1;
"

# Output:
#    dst_ip   | country_code | country_name |  city_name   | latitude  | longitude
# -----------+--------------+--------------+--------------+-----------+----------
#  8.8.8.8   | US           | United States| Mountain View| 37.4192   |-122.0574
```

### Bulk test with multiple IPs:

```bash
# Create test events for various destinations
cat > /tmp/flows.jsonl <<'EOF'
{"src_ip":"10.0.0.5","dst_ip":"1.1.1.1","dst_port":443,"proto":"tcp","bytes_in":1024,"bytes_out":512}
{"src_ip":"10.0.0.5","dst_ip":"142.250.185.46","dst_port":443,"proto":"tcp","bytes_in":2048,"bytes_out":1024}
{"src_ip":"10.0.0.5","dst_ip":"8.8.4.4","dst_port":53,"proto":"udp","bytes_in":100,"bytes_out":50}
EOF

# Send all events
cat /tmp/flows.jsonl | nc localhost 9898

# Verify enrichment
docker compose exec db psql -U zerovpn -d zerovpn -c "
  SELECT COUNT(*) as total_flows, COUNT(*) FILTER (WHERE country_code IS NOT NULL) as geo_enriched
  FROM destination_ips;
"
```

## Database Schema

New columns added in `migrations/00000000000022_destination_ips_geo.sql`:

```sql
ALTER TABLE destination_ips
ADD COLUMN latitude DOUBLE PRECISION,           -- NULL if lookup failed
ADD COLUMN longitude DOUBLE PRECISION,          -- NULL if lookup failed
ADD COLUMN country_code VARCHAR(2),             -- NULL if lookup failed
ADD COLUMN country_name VARCHAR(255),           -- NULL if lookup failed
ADD COLUMN city_name VARCHAR(255);              -- NULL if lookup failed (many IPs lack city resolution)

-- Heatmap queries (group by country/city)
CREATE INDEX idx_destination_ips_geo
ON destination_ips (country_code, city_name, created_at DESC)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Country-level rollups
CREATE INDEX idx_destination_ips_country
ON destination_ips (country_code, created_at DESC)
WHERE country_code IS NOT NULL;
```

## Example Queries

### Heatmap: Total bytes by country

```sql
SELECT
  country_code,
  country_name,
  SUM(bytes_in + bytes_out) as total_bytes,
  COUNT(*) as flow_count,
  ARRAY_AGG(DISTINCT city_name) FILTER (WHERE city_name IS NOT NULL) as cities
FROM destination_ips
WHERE created_at > NOW() - INTERVAL '7 days'
  AND country_code IS NOT NULL
GROUP BY country_code, country_name
ORDER BY total_bytes DESC
LIMIT 20;
```

### Per-device traffic by country (with coordinates):

```sql
SELECT
  d.name,
  di.country_code,
  di.country_name,
  AVG(di.latitude) as avg_lat,
  AVG(di.longitude) as avg_lon,
  COUNT(*) as flow_count,
  SUM(di.bytes_in + di.bytes_out) as total_bytes
FROM destination_ips di
JOIN devices d ON di.device_id = d.id
WHERE di.created_at > NOW() - INTERVAL '24 hours'
  AND di.country_code IS NOT NULL
GROUP BY d.id, d.name, di.country_code, di.country_name
ORDER BY total_bytes DESC;
```

### Top destination cities by flow count:

```sql
SELECT
  city_name,
  country_code,
  COUNT(*) as flow_count,
  SUM(bytes_in + bytes_out) as total_bytes,
  ARRAY_AGG(DISTINCT dst_ip) as destination_ips
FROM destination_ips
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND city_name IS NOT NULL
GROUP BY city_name, country_code
ORDER BY flow_count DESC
LIMIT 10;
```

## Crate/Module Organization

- **zerovpn-core::`geo`** — `GeoReader` struct (thread-safe wrapper, clone-safe)
- **zerovpn-db::`repos::destination_ips`** — Updated `insert()` function with geo parameters
- **zerovpn-worker::`destination_ingest`** — Integrates GeoReader, performs lookup, enriches flows
- **Dependency:** `maxminddb` (workspace) for `.mmdb` file reading

## Future Enhancements

1. **Async enrichment pipeline** — Off-load geo lookups to a separate service to reduce ingest latency
2. **Database versioning** — Track which GeoLite2 version was used for each row (for reproducibility)
3. **IP reputation data** — Enhance with blocklists, ASN info, threat intelligence
4. **Admin UI heatmaps** — Visualize flow destinations on world map (Leaflet.js)
5. **Per-country rate limiting** — Apply different rate limits based on source/destination country
