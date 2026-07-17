#!/usr/bin/env bash
# api-dev entrypoint — thin hot-reload wrapper.
#
# The api now owns the WireGuard runtime itself: on boot it materializes
# wg0.conf from the DB-stored server key (bootstrap::ensure_default_server) and
# brings the interface up (bootstrap::ensure_wg_interface_up) using the
# userspace boringtun backend, then manages peers. So there is no separate `wg`
# container and no wg_config volume — this script just hot-reloads the binary.
#
# Requires (set in docker-compose.dev.yml): NET_ADMIN, /dev/net/tun,
# WG_QUICK_USERSPACE_IMPLEMENTATION=boringtun-cli.
set -uo pipefail

echo "[dev] starting api (it brings up wg0 itself) — first compile takes a few minutes…"
exec watchexec --restart --poll 1s -w crates -- cargo run -p zerovpn-api
