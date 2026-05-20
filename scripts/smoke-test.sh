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

contains() {
    local haystack="$1" needle="$2"
    [[ "$haystack" == *"$needle"* ]]
}

echo "Smoke test against $BASE"

echo "Caddy proxy"
check "caddy /healthz returns 200" curl -fsS "$BASE/healthz"
check "caddy /healthz body == ok" bash -c "[[ \"\$(curl -fsS $BASE/healthz)\" == 'ok' ]]"

echo "API"
check "api /api/v1/ping pong=true" bash -c "curl -fsS $BASE/api/v1/ping | grep -q '\"pong\":true'"

echo "Frontend"
check "frontend / returns HTML" bash -c "curl -fsSL $BASE/ | grep -qi '<html'"

echo "Containers"
check "db is healthy" bash -c "docker compose ps db --format '{{.Health}}' | grep -q healthy"
check "worker is up" bash -c "docker compose ps worker --format '{{.Status}}' | grep -q '^Up'"
check "api is up" bash -c "docker compose ps api --format '{{.Status}}' | grep -q '^Up'"

echo "Worker → API ZMQ"
check "worker is publishing heartbeats" bash -c "docker compose logs worker | grep -q 'events.heartbeat'"
check "api connected ZMQ subscriber" bash -c "docker compose logs api | grep -q 'zmq subscriber'"

# ---- auth + device flow -----------------------------------------------------

echo "Auth flow"
COOKIE=$(mktemp)
trap "rm -f $COOKIE" EXIT
EMAIL="smoke-$(date +%s)@local.test"
PASSWORD="correcthorsebatterystaple"

check "POST /auth/register accepts new account" curl -fsS -c "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/v1/auth/register"

LOGIN_RESP=$(curl -fsS -c "$COOKIE" -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/v1/auth/login")
check "POST /auth/login returns user" bash -c "[[ \"\$0\" == *\"$EMAIL\"* ]]" "$LOGIN_RESP"

ME=$(curl -fsS -b "$COOKIE" "$BASE/api/v1/me")
check "GET /me reflects logged-in user" bash -c "[[ \"\$0\" == *\"$EMAIL\"* ]]" "$ME"

# Create a device.
echo "Device flow"
CREATE=$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"name":"smoke-laptop","os":"linux"}' "$BASE/api/v1/devices")
check "POST /devices returns config" bash -c "[[ \"\$0\" == *\"PrivateKey\"* ]]" "$CREATE"
check "POST /devices includes QR svg" bash -c "[[ \"\$0\" == *\"<svg\"* ]]" "$CREATE"

DEVICE_ID=$(echo "$CREATE" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["device"]["id"])')

LIST=$(curl -fsS -b "$COOKIE" "$BASE/api/v1/devices")
check "GET /devices includes new device" bash -c "[[ \"\$0\" == *\"$DEVICE_ID\"* ]]" "$LIST"

check "POST /devices/{id}/pause works" curl -fsS -b "$COOKIE" -X POST "$BASE/api/v1/devices/$DEVICE_ID/pause"
check "POST /devices/{id}/unpause works" curl -fsS -b "$COOKIE" -X POST "$BASE/api/v1/devices/$DEVICE_ID/unpause"

check "PUT /devices/{id}/dns sets names" curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -X PUT -d '{"dns_names":["smoke-laptop.vpn.local"]}' "$BASE/api/v1/devices/$DEVICE_ID/dns"

# ---- WebSocket / live stats -------------------------------------------------
echo "Live stats over WebSocket"
WS_URL="ws://${BASE#http://}/api/v1/ws"
WS_URL="${WS_URL/https:\/\//wss:\/\/}"
WS_PY=$(mktemp -t ws-smoke.XXXXXX.py)
trap "rm -f $COOKIE $WS_PY" EXIT
cat > "$WS_PY" <<'PYEOF'
import asyncio, os, sys, http.cookies
from websockets.asyncio.client import connect

async def main():
    cookie_path = os.environ['SMOKE_COOKIE']
    ws_url = os.environ['SMOKE_WS_URL']
    jar = http.cookies.SimpleCookie()
    with open(cookie_path) as f:
        for line in f:
            stripped = line.strip()
            if not stripped:
                continue
            # curl marks HttpOnly cookies with a leading "#HttpOnly_". Strip
            # that prefix before parsing; reject any other comment lines.
            if line.startswith('#HttpOnly_'):
                line = line[len('#HttpOnly_'):]
            elif line.startswith('#'):
                continue
            parts = line.split('\t')
            if len(parts) >= 7:
                jar[parts[5]] = parts[6].strip()
    pairs = [f'{k}={m.value}' for k, m in jar.items()]
    headers = {'Cookie': '; '.join(pairs)} if pairs else {}
    async with connect(ws_url, additional_headers=headers) as ws:
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
        except asyncio.TimeoutError:
            sys.exit(1)
        if isinstance(msg, (bytes, bytearray)) and len(msg) > 0:
            sys.exit(0)
        sys.exit(1)

asyncio.run(main())
PYEOF
check "WS receives a frame within 15s" env SMOKE_COOKIE="$COOKIE" SMOKE_WS_URL="$WS_URL" python3 "$WS_PY"

check "DELETE /devices/{id} revokes" curl -fsS -b "$COOKIE" -X DELETE "$BASE/api/v1/devices/$DEVICE_ID"

check "POST /auth/logout flushes session" curl -fsS -b "$COOKIE" -c "$COOKIE" -X POST "$BASE/api/v1/auth/logout"
check "GET /me returns 401 after logout" bash -c "! curl -fsS -b $COOKIE $BASE/api/v1/me >/dev/null 2>&1"

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
