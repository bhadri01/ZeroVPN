import { create } from "zustand"

// 30 minutes at 1-second cadence. Sized to fit the longest lookback any
// page asks for (DeviceDetail's 30 min); shorter consumers (Dashboard's
// 5 min, server live cards on admin/Overview) simply hydrate fewer frames
// and rely on live deltas to fill the rest. Older frames rotate out when
// the cap is hit. Memory: ~30 KB per device, negligible at typical fleet
// sizes.
const HISTORY_CAP = 1800

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

/**
 * Per-server live tick. Populated by `applyServerSample` from the
 * `server_sample` WS event (admin-only). Lets the admin dashboard show
 * server-totals at 1 Hz without summing every per-device sparkline.
 */
export interface ServerLive {
  rxBps: number
  txBps: number
  rxHistory: number[]
  txHistory: number[]
  peerCount: number
  onlineCount: number
  handshakeCount: number
  lastTs: number
}

/** One historical tick. `ts` is unix-ms, matching Event::*.ts_ms. */
export interface HistoricalPoint {
  ts: number
  rxBps: number
  txBps: number
}

/** Per-server historical tick. Includes the extra counters server_samples
 * tracks beyond raw bytes. */
export interface ServerHistoricalPoint extends HistoricalPoint {
  peerCount: number
  onlineCount: number
  handshakeCount: number
}

/**
 * Aggregate of every device's live throughput, coalesced to **one frame
 * per wall-clock second**. Multiple per-device deltas arriving in the
 * same second collapse into a single aggregate frame (the latest sum),
 * so the sidebar sparkline ticks at exactly 1 Hz regardless of how many
 * devices are emitting.
 */
export interface AggregateLive {
  rxHistory: number[]
  txHistory: number[]
  rxBps: number
  txBps: number
  /** Math.floor(latestTsMs / 1000). Used to decide push-vs-replace. */
  lastBucketSec: number
}

/**
 * Host-level health snapshot from the worker's server_health emitter
 * (~5 s cadence). Only admins receive these events; non-admins see the
 * fields hold their zero-state forever. The sidebar panel reads from
 * here. The rolling history is kept for the net I/O sparkline.
 */
export interface ServerHealthLive {
  cpuPct: number
  memUsedBytes: number
  memTotalBytes: number
  activePeers: number
  diskReadBps: number
  diskWriteBps: number
  diskReadHistory: number[]
  diskWriteHistory: number[]
  netRxBps: number
  netTxBps: number
  netRxHistory: number[]
  netTxHistory: number[]
  uptimeSec: number
  lastTs: number
}

interface LiveStatsState {
  devices: Record<string, DeviceLive>
  servers: Record<string, ServerLive>
  aggregate: AggregateLive
  /** Host-level health, keyed by server_id. Sidebar panel reads this. */
  serverHealth: Record<string, ServerHealthLive>
  applyDelta(id: string, rxBps: number, txBps: number, ts?: number): void
  applyServerSample(
    id: string,
    rxBps: number,
    txBps: number,
    peerCount: number,
    onlineCount: number,
    handshakeCount: number,
    ts?: number,
  ): void
  applyServerHealth(
    id: string,
    cpuPct: number,
    memUsedBytes: number,
    memTotalBytes: number,
    activePeers: number,
    diskReadBps: number,
    diskWriteBps: number,
    netRxBps: number,
    netTxBps: number,
    uptimeSec: number,
    ts?: number,
  ): void
  /** Seed a device's rolling history from the /devices/{id}/history
   * endpoint. Subsequent live deltas continue from where the history left
   * off. Idempotent: re-hydration replaces the existing history rather
   * than appending. */
  hydrateDevice(id: string, points: HistoricalPoint[]): void
  /** Seed a server's rolling history from /servers/{id}/history. */
  hydrateServer(id: string, points: ServerHistoricalPoint[]): void
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

const emptyServer = (): ServerLive => ({
  rxBps: 0,
  txBps: 0,
  rxHistory: [],
  txHistory: [],
  peerCount: 0,
  onlineCount: 0,
  handshakeCount: 0,
  lastTs: 0,
})

const emptyAggregate = (): AggregateLive => ({
  rxHistory: [],
  txHistory: [],
  rxBps: 0,
  txBps: 0,
  lastBucketSec: 0,
})

const emptyServerHealth = (): ServerHealthLive => ({
  cpuPct: 0,
  memUsedBytes: 0,
  memTotalBytes: 0,
  activePeers: 0,
  diskReadBps: 0,
  diskWriteBps: 0,
  diskReadHistory: [],
  diskWriteHistory: [],
  netRxBps: 0,
  netTxBps: 0,
  netRxHistory: [],
  netTxHistory: [],
  uptimeSec: 0,
  lastTs: 0,
})

/** Replace the last entry if present, otherwise push. Caps at HISTORY_CAP. */
function replaceLastCapped(arr: number[], next: number): number[] {
  if (arr.length === 0) return [next]
  const out = arr.slice(0)
  out[out.length - 1] = next
  return out.slice(-HISTORY_CAP)
}

/** Rebuild the coalesced aggregate slot by summing per-device histories,
 * right-aligned (so a device that just joined doesn't backfill zeros into
 * the past). Used after hydration to seed the sidebar's chart from the
 * historical samples. */
function buildAggregateFromDevices(
  devices: Record<string, DeviceLive>,
): AggregateLive {
  const list = Object.values(devices)
  if (list.length === 0) return emptyAggregate()
  const maxLen = list.reduce((m, d) => Math.max(m, d.rxHistory.length), 0)
  const rx = new Array<number>(maxLen).fill(0)
  const tx = new Array<number>(maxLen).fill(0)
  let rxBps = 0
  let txBps = 0
  for (const d of list) {
    const offset = maxLen - d.rxHistory.length
    for (let i = 0; i < d.rxHistory.length; i++) {
      rx[offset + i] += d.rxHistory[i]
      tx[offset + i] += d.txHistory[i]
    }
    rxBps += d.rxBps
    txBps += d.txBps
  }
  // bucket the latest tick we know about; live applyDelta calls compare
  // against this so subsequent same-second deltas replace, don't push.
  const lastTs = list.reduce((m, d) => Math.max(m, d.lastTs), 0)
  return {
    rxHistory: rx.slice(-HISTORY_CAP),
    txHistory: tx.slice(-HISTORY_CAP),
    rxBps,
    txBps,
    lastBucketSec: Math.floor(lastTs / 1000),
  }
}

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
  servers: {},
  aggregate: emptyAggregate(),
  serverHealth: {},
  applyDelta(id, rxBps, txBps, ts) {
    set((state) => {
      const cur = state.devices[id] ?? empty()
      const at = ts ?? Date.now()

      // Step 1: update the per-device slot exactly as before.
      const newDevices = {
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
      }

      // Step 2: maintain the coalesced aggregate. We compute totals from
      // newDevices so the latest value of *this* device is included; the
      // remaining devices contribute their last-known rate. Multiple
      // device deltas arriving within the same wall-clock second collapse
      // into a single aggregate frame (we replace the last entry instead
      // of pushing a new one).
      let aggRx = 0
      let aggTx = 0
      for (const d of Object.values(newDevices)) {
        aggRx += d.rxBps
        aggTx += d.txBps
      }
      const bucket = Math.floor(at / 1000)
      const isNewBucket = bucket > state.aggregate.lastBucketSec
      const aggRxHistory = isNewBucket
        ? pushCapped(state.aggregate.rxHistory, aggRx)
        : replaceLastCapped(state.aggregate.rxHistory, aggRx)
      const aggTxHistory = isNewBucket
        ? pushCapped(state.aggregate.txHistory, aggTx)
        : replaceLastCapped(state.aggregate.txHistory, aggTx)

      return {
        devices: newDevices,
        aggregate: {
          rxHistory: aggRxHistory,
          txHistory: aggTxHistory,
          rxBps: aggRx,
          txBps: aggTx,
          lastBucketSec: bucket,
        },
      }
    })
  },
  applyServerSample(id, rxBps, txBps, peerCount, onlineCount, handshakeCount, ts) {
    set((state) => {
      const cur = state.servers[id] ?? emptyServer()
      const at = ts ?? Date.now()
      return {
        servers: {
          ...state.servers,
          [id]: {
            rxBps,
            txBps,
            rxHistory: pushCapped(cur.rxHistory, rxBps),
            txHistory: pushCapped(cur.txHistory, txBps),
            peerCount,
            onlineCount,
            handshakeCount,
            lastTs: at,
          },
        },
      }
    })
  },
  hydrateDevice(id, points) {
    set((state) => {
      const cur = state.devices[id] ?? empty()
      // Live deltas may have arrived already (WS connects before / during
      // the history fetch). Keep any frames whose timestamp is newer than
      // the last historical point, and append them after the seed.
      const lastHistTs = points.length > 0 ? points[points.length - 1].ts : 0
      const liveLen = cur.rxHistory.length
      const liveSinceTs = cur.lastTs > lastHistTs ? cur.lastTs : 0
      const keepLive = liveSinceTs > 0 ? Math.min(liveLen, 1) : 0
      const rxSeed = points.map((p) => p.rxBps)
      const txSeed = points.map((p) => p.txBps)
      if (keepLive > 0) {
        rxSeed.push(cur.rxBps)
        txSeed.push(cur.txBps)
      }
      // Apply HISTORY_CAP — keep the newest entries.
      const rxHistory = rxSeed.slice(-HISTORY_CAP)
      const txHistory = txSeed.slice(-HISTORY_CAP)
      const lastTs = Math.max(cur.lastTs, lastHistTs)
      const peakRx = Math.max(cur.peakRx, ...rxHistory)
      const peakTx = Math.max(cur.peakTx, ...txHistory)
      const newDevices = {
        ...state.devices,
        [id]: {
          rxBps: cur.rxBps,
          txBps: cur.txBps,
          rxHistory,
          txHistory,
          lastTs,
          peakRx,
          peakTx,
          totalRx: cur.totalRx,
          totalTx: cur.totalTx,
        },
      }
      // Rebuild the coalesced aggregate from every hydrated device. Each
      // device's history is per-tick already (the historical endpoint
      // returns rows at the worker's poll cadence), so summing index-by-
      // index after right-aligning gives one aggregate frame per second.
      const aggregate = buildAggregateFromDevices(newDevices)
      return { devices: newDevices, aggregate }
    })
  },
  hydrateServer(id, points) {
    set((state) => {
      const cur = state.servers[id] ?? emptyServer()
      const lastHistTs = points.length > 0 ? points[points.length - 1].ts : 0
      const rxSeed = points.map((p) => p.rxBps).slice(-HISTORY_CAP)
      const txSeed = points.map((p) => p.txBps).slice(-HISTORY_CAP)
      const last = points[points.length - 1]
      return {
        servers: {
          ...state.servers,
          [id]: {
            rxBps: cur.rxBps,
            txBps: cur.txBps,
            rxHistory: rxSeed,
            txHistory: txSeed,
            peerCount: last?.peerCount ?? cur.peerCount,
            onlineCount: last?.onlineCount ?? cur.onlineCount,
            handshakeCount: last?.handshakeCount ?? cur.handshakeCount,
            lastTs: Math.max(cur.lastTs, lastHistTs),
          },
        },
      }
    })
  },
  applyServerHealth(
    id,
    cpuPct,
    memUsedBytes,
    memTotalBytes,
    activePeers,
    diskReadBps,
    diskWriteBps,
    netRxBps,
    netTxBps,
    uptimeSec,
    ts,
  ) {
    set((state) => {
      const cur = state.serverHealth[id] ?? emptyServerHealth()
      const at = ts ?? Date.now()
      return {
        serverHealth: {
          ...state.serverHealth,
          [id]: {
            cpuPct,
            memUsedBytes,
            memTotalBytes,
            activePeers,
            diskReadBps,
            diskWriteBps,
            diskReadHistory: pushCapped(cur.diskReadHistory, diskReadBps),
            diskWriteHistory: pushCapped(cur.diskWriteHistory, diskWriteBps),
            netRxBps,
            netTxBps,
            netRxHistory: pushCapped(cur.netRxHistory, netRxBps),
            netTxHistory: pushCapped(cur.netTxHistory, netTxBps),
            uptimeSec,
            lastTs: at,
          },
        },
      }
    })
  },
  reset() {
    set({
      devices: {},
      servers: {},
      aggregate: emptyAggregate(),
      serverHealth: {},
    })
  },
}))

/**
 * Aggregate sparkline data across every device. Takes the stable
 * `devices` map (NOT the whole state); call from a `useMemo` keyed on
 * `useLiveStats(s => s.devices)` so the result has a stable reference
 * between renders. Returning a new object on every store read would
 * make `useSyncExternalStore` loop (React error #185).
 *
 * `window`: take only the most recent N frames per device before
 * summing — a sliding window (new pushes, oldest drops).
 *
 * When `window` is set, the output is **always exactly `window` frames
 * long**, zero-padded on the left when not enough history has arrived
 * yet. This stops the chart from "growing" at startup; the sparkline
 * keeps a stable width and the X axis never re-maps. Omit `window` for
 * the legacy uncapped/unpadded behavior.
 */
export function aggregateLiveStats(
  devices: Record<string, DeviceLive>,
  window?: number,
): { rxHistory: number[]; txHistory: number[]; rxBps: number; txBps: number } {
  const list = Object.values(devices)
  if (list.length === 0) {
    if (window !== undefined && window > 0) {
      const zeros = new Array<number>(window).fill(0)
      return { rxHistory: zeros, txHistory: zeros, rxBps: 0, txBps: 0 }
    }
    return { rxHistory: [], txHistory: [], rxBps: 0, txBps: 0 }
  }
  const padded = window !== undefined && window > 0
  // Per-device tail slice. When `window` is unset, the slice is a no-op
  // (negative length yields the original array via slice(-N) semantics).
  const slices = list.map((d) =>
    padded
      ? {
          rx: d.rxHistory.slice(-(window as number)),
          tx: d.txHistory.slice(-(window as number)),
        }
      : { rx: d.rxHistory, tx: d.txHistory },
  )
  const maxLen = padded
    ? (window as number)
    : slices.reduce((m, s) => Math.max(m, s.rx.length), 0)
  const rx = new Array<number>(maxLen).fill(0)
  const tx = new Array<number>(maxLen).fill(0)
  for (const s of slices) {
    const offset = maxLen - s.rx.length
    for (let i = 0; i < s.rx.length; i++) {
      rx[offset + i] += s.rx[i]
      tx[offset + i] += s.tx[i]
    }
  }
  let totalRx = 0
  let totalTx = 0
  for (const d of list) {
    totalRx += d.rxBps
    totalTx += d.txBps
  }
  return { rxHistory: rx, txHistory: tx, rxBps: totalRx, txBps: totalTx }
}
