import { create } from "zustand"

const HISTORY_CAP = 60

export interface DeviceLive {
  rxBps: number
  txBps: number
  rxHistory: number[]
  txHistory: number[]
  lastTs: number
  peakRx: number
  peakTx: number
  totalRx: number
  totalTx: number
}

interface LiveStatsState {
  devices: Record<string, DeviceLive>
  applyDelta(id: string, rxBps: number, txBps: number, ts?: number): void
  reset(): void
}

const empty = (): DeviceLive => ({
  rxBps: 0,
  txBps: 0,
  rxHistory: [],
  txHistory: [],
  lastTs: 0,
  peakRx: 0,
  peakTx: 0,
  totalRx: 0,
  totalTx: 0,
})

function pushCapped(arr: number[], next: number): number[] {
  if (arr.length < HISTORY_CAP) return [...arr, next]
  // rotate without spreading the whole array twice
  const out = arr.slice(1)
  out.push(next)
  return out
}

/**
 * Single source of truth for in-flight device throughput.
 *
 * The WS connection lives in `<LiveStatsProvider>` (mounted once at
 * DashboardLayout) and dispatches `stats_delta` events through
 * `applyDelta`. Every consumer reads from this store, so navigating
 * between pages doesn't tear down the WS or reset the rolling histories.
 *
 * History windows are capped at 60 frames (≈ 5 minutes at 5 s polls,
 * 30 s at 0.5 s simulation). When a device hasn't been heard from in
 * three windows we leave its history in place — the chart shows it
 * trail off naturally.
 */
export const useLiveStats = create<LiveStatsState>((set) => ({
  devices: {},
  applyDelta(id, rxBps, txBps, ts) {
    set((state) => {
      const cur = state.devices[id] ?? empty()
      const at = ts ?? Date.now()
      return {
        devices: {
          ...state.devices,
          [id]: {
            rxBps,
            txBps,
            rxHistory: pushCapped(cur.rxHistory, rxBps),
            txHistory: pushCapped(cur.txHistory, txBps),
            lastTs: at,
            peakRx: Math.max(cur.peakRx, rxBps),
            peakTx: Math.max(cur.peakTx, txBps),
            totalRx: cur.totalRx + rxBps,
            totalTx: cur.totalTx + txBps,
          },
        },
      }
    })
  },
  reset() {
    set({ devices: {} })
  },
}))

/**
 * Aggregate sparkline data across every device in the store. Returns
 * arrays of equal length (the longest device's history); shorter
 * histories are zero-padded at the head so all devices align in time.
 *
 * Used by the sidebar mini-chart to show "all devices, all the time"
 * without having to pick one.
 */
export function aggregateLiveStats(state: LiveStatsState) {
  const devices = Object.values(state.devices)
  if (devices.length === 0) {
    return { rxHistory: [], txHistory: [], rxBps: 0, txBps: 0 }
  }
  const maxLen = devices.reduce((m, d) => Math.max(m, d.rxHistory.length), 0)
  const rx = new Array<number>(maxLen).fill(0)
  const tx = new Array<number>(maxLen).fill(0)
  for (const d of devices) {
    const offset = maxLen - d.rxHistory.length
    for (let i = 0; i < d.rxHistory.length; i++) {
      rx[offset + i] += d.rxHistory[i]
      tx[offset + i] += d.txHistory[i]
    }
  }
  let totalRx = 0
  let totalTx = 0
  for (const d of devices) {
    totalRx += d.rxBps
    totalTx += d.txBps
  }
  return { rxHistory: rx, txHistory: tx, rxBps: totalRx, txBps: totalTx }
}
