import { decode } from "@msgpack/msgpack"
import { useEffect, useRef, useState } from "react"

import type { Event } from "@/lib/wire"

type ConnectionState = "connecting" | "open" | "closed"

interface UseWebSocketReturn {
  state: ConnectionState
}

interface Options {
  /** Endpoint path, e.g. "/api/v1/ws". */
  path: string
  /** Called for every decoded event. */
  onEvent: (event: Event) => void
  /** Whether to enable the connection (e.g. only when logged in). */
  enabled?: boolean
}

/**
 * Reconnecting WebSocket hook with exponential backoff and a 25s heartbeat
 * ping. Decodes binary frames via MessagePack into our `Event` type.
 *
 * The frame layout matches `crates/zerovpn-wire::Event` (serde + rmp-serde
 * `to_vec_named`). When the WASM port lands, swap `decode()` for the WASM
 * binding and the on-wire format stays identical.
 */
export function useWebSocket({
  path,
  onEvent,
  enabled = true,
}: Options): UseWebSocketReturn {
  const [state, setState] = useState<ConnectionState>("closed")
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let socket: WebSocket | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let backoffMs = 250

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${proto}//${window.location.host}${path}`

    const connect = () => {
      if (cancelled) return
      setState("connecting")
      const ws = new WebSocket(url)
      ws.binaryType = "arraybuffer"
      socket = ws

      ws.onopen = () => {
        if (cancelled) return
        backoffMs = 250
        setState("open")
        pingTimer = setInterval(() => {
          // Browsers don't expose ping frames; we send a tiny binary frame
          // that the server side ignores. Real ping/pong arrives in 1B-C.
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(new Uint8Array([0]))
            } catch {
              // ignore
            }
          }
        }, 25_000)
      }

      ws.onmessage = (msg) => {
        if (typeof msg.data === "string") return
        try {
          const event = decode(new Uint8Array(msg.data as ArrayBuffer)) as Event
          onEventRef.current(event)
        } catch (e) {
          console.warn("ws decode", e)
        }
      }

      ws.onclose = () => {
        if (pingTimer) {
          clearInterval(pingTimer)
          pingTimer = null
        }
        if (cancelled) {
          setState("closed")
          return
        }
        setState("closed")
        const wait = backoffMs
        backoffMs = Math.min(backoffMs * 2, 10_000)
        setTimeout(connect, wait)
      }

      ws.onerror = () => {
        // close handler will retry
        try {
          ws.close()
        } catch {
          // ignore
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (pingTimer) clearInterval(pingTimer)
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close()
    }
  }, [path, enabled])

  // While disabled, the socket is torn down (or never opened) — report
  // "closed" regardless of what the last enabled run left in state.
  return { state: enabled ? state : "closed" }
}
