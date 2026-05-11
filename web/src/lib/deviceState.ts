import type { PublicDevice } from "@/lib/api"

/** Connection state — is the tunnel currently up?
 *  - `online`  active + handshake within ONLINE_HANDSHAKE_WINDOW_MS
 *  - `offline` everything else (paused, revoked, never-handshaked, stale)
 *
 *  Used everywhere we display "live" throughput / status. Anything not
 *  `online` cannot be transmitting right now, so any rate the WS store
 *  still holds for it is stale and must NOT be surfaced as live data. */
export type ConnState = "online" | "offline"

/** Peer state — admin lifecycle. 1:1 mirror of wire `DeviceStatus`, just
 *  renamed so "live" reads better than "active" alongside "online". */
export type PeerState = "live" | "paused" | "revoked"

/** WireGuard's default keepalive is 25 s; real-world handshakes happen
 *  every ~2 min. 3 minutes is the conservative connectivity bound. */
export const ONLINE_HANDSHAKE_WINDOW_MS = 3 * 60_000

export function connState(d: PublicDevice): ConnState {
  if (d.status !== "active") return "offline"
  if (!d.last_handshake_at) return "offline"
  const age = Date.now() - new Date(d.last_handshake_at).getTime()
  return age <= ONLINE_HANDSHAKE_WINDOW_MS ? "online" : "offline"
}

export function peerState(d: PublicDevice): PeerState {
  switch (d.status) {
    case "active":
      return "live"
    case "paused":
      return "paused"
    case "revoked":
      return "revoked"
  }
}
