#!/usr/bin/env bash
# Run a command with the dev environment rewritten for native (non-docker)
# execution. Reads `.env` as the source of truth, then rewrites container
# hostnames (db, redis, worker, mailhog) to their localhost port mappings
# from docker-compose.yml.
#
# Usage:
#   ./scripts/dev-native.sh cargo run -p zerovpn-api
#   ./scripts/dev-native.sh cargo run -p zerovpn-worker
#   ./scripts/dev-native.sh env | grep ZEROVPN_       # inspect resolved values
#
# Requires `make dev` to be running (db, redis, mailhog, dnsmasq up; api +
# worker stopped).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    echo "ERROR: .env not found. Run: make setup" >&2
    exit 1
fi

# Parse .env as KEY=VALUE without shell expansion. We can't `source` it
# because values like `ZeroVPN <noreply@localhost>` contain `<`, which bash
# would interpret as a redirect. Docker compose parses .env this way already.
while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line// }" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" == "$line" ]] && continue
    if [[ "$value" =~ ^\".*\"$ ]] || [[ "$value" =~ ^\'.*\'$ ]]; then
        value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
done < .env

# Container hostnames → host localhost ports (matches docker-compose.yml).
export ZEROVPN_DATABASE_URL="${ZEROVPN_DATABASE_URL/@db:5432/@localhost:55432}"
export ZEROVPN_REDIS_URL="${ZEROVPN_REDIS_URL/@redis:6379/@localhost:56379}"
export ZEROVPN_SMTP__HOST=localhost
export ZEROVPN_SMTP__PORT=1025

# ZMQ: native worker binds on 127.0.0.1:5555; native api connects there.
export ZEROVPN_EVENTS__PUBLISHER_BIND="tcp://127.0.0.1:5555"
export ZEROVPN_EVENTS__SUBSCRIBER_CONNECT="tcp://127.0.0.1:5555"

# Bind only to loopback when running natively.
export ZEROVPN_BIND_ADDRESS="127.0.0.1:8080"

# Static paths the dockerized api would write into the wg_config volume —
# in native mode point them at a workspace-local dir we control.
mkdir -p .dev-native/wg .dev-native/dnsmasq
export ZEROVPN_WG__SERVER_CONFIG_PATH="$PWD/.dev-native/wg/wg0.conf"
export ZEROVPN_WG__DNSMASQ_HOSTS_FILE="$PWD/.dev-native/dnsmasq/zerovpn-peers.conf"

if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <command> [args...]" >&2
    exit 1
fi

exec "$@"
