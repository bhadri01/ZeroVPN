/**
 * EMA smoothing for topology edge rates. Lives in its own tiny module so
 * the lazy TopologyGraph wrapper doesn't drag the d3-force/recharts bundle
 * in just to get this helper.
 */
export function applyEmaSmoothing(
  prev: Map<string, { rxBps: number; txBps: number }>,
  next: { deviceId: string; rxBps: number; txBps: number },
  alpha = 0.4,
): Map<string, { rxBps: number; txBps: number }> {
  const updated = new Map(prev)
  const old = updated.get(next.deviceId) ?? { rxBps: 0, txBps: 0 }
  updated.set(next.deviceId, {
    rxBps: alpha * next.rxBps + (1 - alpha) * old.rxBps,
    txBps: alpha * next.txBps + (1 - alpha) * old.txBps,
  })
  return updated
}
