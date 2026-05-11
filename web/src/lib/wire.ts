/**
 * Wire schema mirroring crates/zerovpn-wire::Event.
 * Keep in sync; future iteration will replace this with WASM-decoded types
 * from the same Rust crate.
 */

export type Event =
  | { type: "heartbeat"; ts_ms: number }
  | {
      type: "stats_delta"
      device_id: string
      user_id: string
      rx_bytes: number
      tx_bytes: number
      rate_rx_bps: number
      rate_tx_bps: number
      ts_ms: number
    }
  | {
      type: "handshake_change"
      device_id: string
      user_id: string
      last_handshake_ms: number
    }
  | {
      type: "peer_status_changed"
      device_id: string
      user_id: string
      status: "active" | "paused" | "revoked"
    }
  | {
      type: "dns_updated"
      device_id: string
      user_id: string
      dns_names: string[]
    }
  | {
      type: "server_health"
      server_id: string
      cpu_pct: number
      mem_used_bytes: number
      mem_total_bytes: number
      active_peers: number
      disk_read_bps: number
      disk_write_bps: number
      net_rx_bps: number
      net_tx_bps: number
      uptime_sec: number
      ts_ms: number
    }
  | {
      type: "server_sample"
      server_id: string
      total_rx_bytes: number
      total_tx_bytes: number
      rate_rx_bps: number
      rate_tx_bps: number
      peer_count: number
      online_count: number
      handshake_count: number
      ts_ms: number
    }
