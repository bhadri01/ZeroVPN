#!/usr/bin/env bash
# Generates random secrets for an environment.
#
#   ./scripts/init-secrets.sh dev      # writes .env.dev + secrets/dev/*.txt
#   ./scripts/init-secrets.sh prod     # writes .env.prod + secrets/prod/*.txt
#
# Idempotent: only replaces values that are still CHANGEME, and only writes
# secret files that don't already exist. Run again after a rotation by first
# deleting the relevant files (see docs/runbook.md → "Rotating secrets").
set -euo pipefail

cd "$(dirname "$0")/.."

env_name="${1:-}"
case "$env_name" in
    dev|prod) ;;
    "")
        echo "Usage: $0 <dev|prod>" >&2
        exit 1
        ;;
    *)
        echo "ERROR: unknown environment '$env_name' (expected: dev | prod)" >&2
        exit 1
        ;;
esac

env_file=".env.${env_name}"
secrets_dir="secrets/${env_name}"

if [[ ! -f "$env_file" ]]; then
    echo "ERROR: $env_file not found. Run: cp .env.${env_name}.example $env_file" >&2
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
tmp="${env_file}.tmp.$$"
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
' "$env_file" > "$tmp"
mv "$tmp" "$env_file"

# Per-environment secrets directory. Different KEKs/DB passwords across envs
# is a security requirement, not a convenience.
mkdir -p "$secrets_dir"
chmod 700 "$secrets_dir"

write_if_missing() {
    local path="$1"
    local value="$2"
    [[ -f "$path" ]] && return 0
    printf '%s' "$value" > "$path"
    chmod 600 "$path"
}

write_if_missing "$secrets_dir/db_password.txt"      "$db_password"
write_if_missing "$secrets_dir/redis_password.txt"   "$redis_password"
write_if_missing "$secrets_dir/session_secret.txt"   "$session_secret"
write_if_missing "$secrets_dir/kek.txt"              "$kek"

echo "Secrets initialized for '$env_name' in $env_file + $secrets_dir/."
