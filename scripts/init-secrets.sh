#!/usr/bin/env bash
# Generates random secrets and writes them into `.env` + `secrets/*.txt`.
#
#   ./scripts/init-secrets.sh
#
# Idempotent: only replaces values that are still CHANGEME, and only writes
# secret files that don't already exist. Run again after a rotation by first
# deleting the relevant files (see docs/runbook.md → "Rotating secrets").
set -euo pipefail

cd "$(dirname "$0")/.."

env_file=".env"
secrets_dir="secrets"

if [[ ! -f "$env_file" ]]; then
    echo "ERROR: $env_file not found. Run: cp .env.example $env_file" >&2
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

# Replace any CHANGEME occurrences with the appropriate value.
# Order matters: replace specific patterns first so we don't accidentally
# substitute the same value into multiple places.
tmp="${env_file}.tmp.$$"
awk -v ss="$session_secret" -v kek="$kek" -v dbpw="$db_password" '
    /^ZEROVPN_SESSION_SECRET=CHANGEME/ { print "ZEROVPN_SESSION_SECRET=" ss; next }
    /^ZEROVPN_KEK=CHANGEME/             { print "ZEROVPN_KEK=" kek; next }
    /^ZEROVPN_DATABASE_URL=.*CHANGEME/  {
        line=$0; gsub("CHANGEME", dbpw, line); print line; next
    }
    { print }
' "$env_file" > "$tmp"
mv "$tmp" "$env_file"
chmod 600 "$env_file"

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
write_if_missing "$secrets_dir/session_secret.txt"   "$session_secret"
write_if_missing "$secrets_dir/kek.txt"              "$kek"

echo "Secrets initialized in $env_file + $secrets_dir/."
