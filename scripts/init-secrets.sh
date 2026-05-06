#!/usr/bin/env bash
# Generates random secrets into .env (in-place edit) on first setup.
# Idempotent: only replaces values that are still CHANGEME.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    echo "ERROR: .env not found. Run: cp .env.example .env" >&2
    exit 1
fi

gen_b64() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -base64 32 | tr -d '\n'
    else
        head -c 32 /dev/urandom | base64 | tr -d '\n'
    fi
}

gen_pw() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 24
    else
        head -c 24 /dev/urandom | xxd -p -c 64
    fi
}

session_secret="$(gen_b64)"
kek="$(gen_b64)"
db_password="$(gen_pw)"
redis_password="$(gen_pw)"

# Replace any CHANGEME occurrences with the appropriate value.
# Order matters: replace specific patterns first so we don't accidentally
# substitute the same value into multiple places.
tmp=".env.tmp.$$"
awk -v ss="$session_secret" -v kek="$kek" -v dbpw="$db_password" -v rpw="$redis_password" '
    /^ZEROVPN_SESSION_SECRET=CHANGEME/ { print "ZEROVPN_SESSION_SECRET=" ss; next }
    /^ZEROVPN_KEK=CHANGEME/             { print "ZEROVPN_KEK=" kek; next }
    /^ZEROVPN_DATABASE_URL=.*CHANGEME/  {
        line=$0; gsub("CHANGEME", dbpw, line); print line; next
    }
    /^ZEROVPN_REDIS_URL=.*CHANGEME/     {
        line=$0; gsub("CHANGEME", rpw, line); print line; next
    }
    { print }
' .env > "$tmp"
mv "$tmp" .env

# Also write standalone secrets files for compose to mount.
mkdir -p secrets
chmod 700 secrets

[[ -f secrets/db_password.txt ]] || { printf '%s' "$db_password" > secrets/db_password.txt && chmod 600 secrets/db_password.txt; }
[[ -f secrets/redis_password.txt ]] || { printf '%s' "$redis_password" > secrets/redis_password.txt && chmod 600 secrets/redis_password.txt; }
[[ -f secrets/session_secret.txt ]] || { printf '%s' "$session_secret" > secrets/session_secret.txt && chmod 600 secrets/session_secret.txt; }
[[ -f secrets/kek.txt ]] || { printf '%s' "$kek" > secrets/kek.txt && chmod 600 secrets/kek.txt; }

echo "Secrets initialized. Database password also written to secrets/db_password.txt."
