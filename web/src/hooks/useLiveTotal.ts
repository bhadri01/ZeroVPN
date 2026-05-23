import { useLiveStats } from "@/stores/liveStats"

/**
 * Combine a device's **persisted** cumulative RX/TX total (from the API —
 * `device.total_rx_bytes` / `total_tx_bytes`, refetched periodically) with
 * the **live** lifetime total streamed in `stats_delta`, so the figure grows
 * every second instead of only jumping on refetch.
 *
 * Both numbers are the *same* authoritative, monotonic lifetime counter the
 * worker maintains (the API reads the persisted column; the WS frame carries
 * the freshest in-memory value). So we simply take the larger of the two:
 * between refetches the live value pulls ahead; a refetch brings the API
 * value back in line. No local accumulation, so nothing drifts on a dropped
 * frame — the next frame carries the correct absolute again.
 */
export function useLiveTotal(
  deviceId: string,
  apiRx: number,
  apiTx: number,
): { rx: number; tx: number } {
  const liveRx = useLiveStats((s) => s.devices[deviceId]?.lifeRxBytes ?? 0)
  const liveTx = useLiveStats((s) => s.devices[deviceId]?.lifeTxBytes ?? 0)

  return {
    rx: Math.max(apiRx, liveRx),
    tx: Math.max(apiTx, liveTx),
  }
}
