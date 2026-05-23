#!/usr/bin/env bash
# api-dev entrypoint: bring up a real (userspace) WireGuard interface in this
# container, then hot-reload the api against it.
#
# Why the key dance: the server's WG private key only ever lives on the
# interface (it is never stored in the DB). So in dev we generate/persist a
# keypair in the wg_config volume and push its *public* key into the `servers`
# row, so client configs the api hands out match this interface. The endpoint
# (LAN IP) is synced separately by the api's own dev bootstrap.
set -uo pipefail

IFACE="${ZEROVPN_WG__INTERFACE:-wg0}"
PORT="${ZEROVPN_WG__LISTEN_PORT:-51820}"
CONF="/wg/${IFACE}.conf"

mkdir -p /wg
umask 077

# 1) Ensure a server keypair + interface config exist (persisted across runs).
if [[ ! -s "$CONF" ]]; then
    echo "[wg] generating server keypair + $CONF"
    wg genkey > /wg/server_private.key
    priv="$(cat /wg/server_private.key)"
    cat > "$CONF" <<EOF
[Interface]
Address = 10.10.0.1/22
ListenPort = $PORT
PrivateKey = $priv
EOF
fi

# Self-heal: older configs embedded PostUp/PostDown firewall lines that make
# wg-quick roll the whole interface back if iptables/nat aren't usable in this
# container. Strip them — forwarding/NAT is applied best-effort after the
# interface is up (and isn't needed at all for split-tunnel to the VPN subnet).
sed -i '/^PostUp/d; /^PostDown/d' "$CONF"

priv="$(awk '/PrivateKey/{print $3; exit}' "$CONF")"
pub="$(printf '%s' "$priv" | wg pubkey)"
echo "[wg] server public key: $pub"

# 2) Sync the public key into the DB so issued client configs match this
#    interface. (db is healthy before this container starts — see depends_on.)
if [[ -n "${ZEROVPN_DATABASE_URL:-}" ]]; then
    if psql "$ZEROVPN_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
        "UPDATE servers SET public_key='$pub' WHERE name='default';" >/dev/null 2>&1; then
        echo "[wg] synced server public_key into DB (re-download existing device configs)"
    else
        echo "[wg] WARN: could not sync public_key to DB"
    fi
fi

# 3) Bring up the interface. Uses the kernel module if Docker Desktop has it,
#    otherwise falls back to the boringtun userspace implementation.
export WG_QUICK_USERSPACE_IMPLEMENTATION="${WG_QUICK_USERSPACE_IMPLEMENTATION:-boringtun-cli}"
export WG_SUDO=1
wg-quick down "$CONF" >/dev/null 2>&1 || true
ip link del "$IFACE" >/dev/null 2>&1 || true
if wg-quick up "$CONF"; then
    echo "[wg] $IFACE up on udp/$PORT"
    # Forwarding + NAT for full-tunnel clients — best-effort; not required for
    # split-tunnel to the VPN subnet.
    sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
    iptables -A FORWARD -i "$IFACE" -j ACCEPT 2>/dev/null || true
    iptables -A FORWARD -o "$IFACE" -j ACCEPT 2>/dev/null || true
    iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || true

    # DNS: peers are handed 10.10.0.1 as their resolver, but nothing listens
    # on it here. Forward those queries to the CoreDNS (`dnsmasq`) container —
    # it serves *.vpn.local from the shared hosts file and forwards public
    # names upstream. api-dev shares the backend bridge with CoreDNS, so we
    # resolve it by service name (or use ZEROVPN_WG__DNS_FORWARD_IP if set).
    # Without this a full-tunnel peer can't resolve anything → "no internet".
    DNS_FWD="${ZEROVPN_WG__DNS_FORWARD_IP:-}"
    if [[ -z "$DNS_FWD" ]]; then
        DNS_FWD="$(getent hosts dnsmasq 2>/dev/null | awk '{print $1; exit}')"
    fi
    if [[ -n "$DNS_FWD" ]]; then
        echo "[wg] forwarding peer DNS ${IFACE} 10.10.0.1:53 -> ${DNS_FWD}:53 (CoreDNS)"
        for proto in udp tcp; do
            iptables -t nat -A PREROUTING -i "$IFACE" -d 10.10.0.1 -p "$proto" --dport 53 \
                -j DNAT --to-destination "${DNS_FWD}:53" 2>/dev/null || true
            iptables -t nat -A POSTROUTING -d "$DNS_FWD" -p "$proto" --dport 53 \
                -j MASQUERADE 2>/dev/null || true
        done
    else
        echo "[wg] WARN: could not resolve CoreDNS; *.vpn.local will not resolve"
    fi
    wg show "$IFACE" 2>/dev/null || true
else
    echo "[wg] WARN: 'wg-quick up' failed — api still runs, but no live tunnel"
fi

# 4) Hot-reload the api (auto-runs DB migrations on boot). First compile takes
#    a few minutes on a bind mount.
echo "[dev] starting api — first compile takes a few minutes…"
exec watchexec --restart --poll 1s -w crates -- cargo run -p zerovpn-api
