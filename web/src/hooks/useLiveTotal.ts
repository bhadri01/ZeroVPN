import { useState } from "react"

import { useLiveStats } from "@/stores/liveStats"

/**
 * Combine a device's **persisted** cumulative RX/TX total (from the API —
 * `device.total_rx_bytes` / `total_tx_bytes`, refetched periodically) with
 * the **live** bytes that have streamed in since, so the figure grows every
 * second instead of only jumping on refetch.
 *
 * `apiRx` / `apiTx` are the authoritative totals. We snapshot the store's
 * session byte counters at the moment the API value changes (a refetch),
 * then add everything accumulated since:
 *
 *   displayed = apiTotal + (sessionBytesNow − sessionBytesAtRefetch)
 *
 * Because the refetched API total already includes that live traffic, the
 * value is continuous across a refetch (no jump) and self-corrects any
 * drift from dropped WS frames. `Math.max(0, …)` guards a store reset.
 */
export function useLiveTotal(
  deviceId: string,
  apiRx: number,
  apiTx: number,
): { rx: number; tx: number } {
  const sessRx = useLiveStats((s) => s.devices[deviceId]?.sessRxBytes ?? 0)
  const sessTx = useLiveStats((s) => s.devices[deviceId]?.sessTxBytes ?? 0)

  // Re-baseline whenever the API total changes (a refetch). This is the
  // React "adjust state during render on prop change" pattern — the guard
  // makes it converge in one extra render, no effect needed.
  const [base, setBase] = useState({ apiRx, apiTx, sessRx, sessTx })
  if (base.apiRx !== apiRx || base.apiTx !== apiTx) {
    setBase({ apiRx, apiTx, sessRx, sessTx })
  }

  return {
    rx: apiRx + Math.max(0, sessRx - base.sessRx),
    tx: apiTx + Math.max(0, sessTx - base.sessTx),
  }
}
