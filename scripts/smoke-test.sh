#!/usr/bin/env bash
# End-to-end smoke test for the running stack.
# Assumes `make up` was run and the stack is healthy.
set -euo pipefail

BASE="${ZEROVPN_BASE:-http://localhost}"
PASS=0; FAIL=0
check() {
    local name="$1"; shift
    if "$@" >/dev/null 2>&1; then
        echo "  ✓ $name"
        PASS=$((PASS+1))
    else
        echo "  ✗ $name"
        FAIL=$((FAIL+1))
    fi
}

echo "Smoke test against $BASE"

echo "Caddy proxy"
check "caddy /healthz returns 200" curl -fsS "$BASE/healthz"
check "caddy /healthz body == ok" bash -c "[[ \"\$(curl -fsS $BASE/healthz)\" == 'ok' ]]"

echo "API"
check "api /health returns 200" curl -fsS "$BASE/api/v1/ping"  # ping is on /api/v1; /health is direct
check "api /api/v1/ping pong=true" bash -c "curl -fsS $BASE/api/v1/ping | grep -q '\"pong\":true'"

echo "Frontend"
check "frontend /healthz returns 200" curl -fsS "$BASE/healthz"
check "frontend / returns HTML" bash -c "curl -fsSL $BASE/ | grep -qi '<html'"

echo "Containers"
check "db is healthy" bash -c "docker compose -f docker-compose.yml -f docker-compose.dev.yml ps db --format '{{.Health}}' | grep -q healthy"
check "worker is up" bash -c "docker compose -f docker-compose.yml -f docker-compose.dev.yml ps worker --format '{{.Status}}' | grep -q '^Up'"
check "api is up" bash -c "docker compose -f docker-compose.yml -f docker-compose.dev.yml ps api --format '{{.Status}}' | grep -q '^Up'"

echo "Worker → API ZMQ"
check "worker is publishing heartbeats" bash -c "docker compose -f docker-compose.yml -f docker-compose.dev.yml logs worker | grep -q 'heartbeat published'"
check "api connected ZMQ subscriber" bash -c "docker compose -f docker-compose.yml -f docker-compose.dev.yml logs api | grep -q 'zmq subscriber'"

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
