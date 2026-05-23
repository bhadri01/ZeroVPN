import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"

import {
  type Candle,
  type Timeframe,
  deviceCandles,
  serverCandles,
  userCandles,
} from "@/lib/api"

export type CandleScope = "device" | "server" | "user"

/** Candles fetched per request. The latest page auto-refreshes; older pages
 *  are loaded on demand (cursor = oldest loaded bucket) as the user pans. */
const PAGE = 200

export interface CandleSeries {
  /** Chronological (oldest→newest), de-duplicated across all loaded pages. */
  candles: Candle[]
  /** Pull one more page of older candles (no-op while one is in flight or
   *  the history is exhausted). */
  loadOlder: () => void
  isLoadingOlder: boolean
  /** Whether the last older fetch returned a full page (more may exist). */
  hasMore: boolean
  isLoading: boolean
  isError: boolean
}

/**
 * Time-series buffer for the candle chart. Combines:
 *  - a react-query "latest page" that auto-refreshes (so candles advance in
 *    real time as the worker flushes each minute), and
 *  - an accumulated stack of older pages fetched lazily via the `before`
 *    cursor when the chart pans/scrolls into history.
 *
 * Both are merged + de-duped by `bucket_start` so overlapping fetches never
 * double-count. Switching timeframe (or target) resets the older buffer.
 */
export function useCandleSeries(
  scope: CandleScope,
  id: string,
  tf: Timeframe,
): CandleSeries {
  // One page, optionally before a cursor. The `user` scope is session-keyed
  // (aggregates the caller's own devices) and ignores `id`.
  const load = useCallback(
    (before?: string) =>
      scope === "device"
        ? deviceCandles(id, tf, PAGE, before)
        : scope === "server"
          ? serverCandles(id, tf, PAGE, before)
          : userCandles(tf, PAGE, before),
    [scope, id, tf],
  )

  // Latest page — refetched on an interval so the newest candle keeps moving.
  const latestQ = useQuery({
    queryKey: ["candles", scope, id, tf, "latest"],
    queryFn: () => load(),
    enabled: scope === "user" || id.length > 0,
    refetchInterval: tf === "1m" ? 15_000 : 60_000,
  })

  const [older, setOlder] = useState<Candle[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)

  // A fresh timeframe/target invalidates everything we paged in.
  useEffect(() => {
    setOlder([])
    setHasMore(true)
    setIsLoadingOlder(false)
  }, [scope, id, tf])

  const latest = useMemo(() => latestQ.data?.candles ?? [], [latestQ.data])

  const candles = useMemo(() => {
    const map = new Map<string, Candle>()
    for (const c of older) map.set(c.bucket_start, c)
    for (const c of latest) map.set(c.bucket_start, c)
    return [...map.values()].sort((a, b) =>
      a.bucket_start < b.bucket_start ? -1 : 1,
    )
  }, [older, latest])

  const loadOlder = useCallback(() => {
    if (isLoadingOlder || !hasMore || candles.length === 0) return
    const cursor = candles[0].bucket_start
    setIsLoadingOlder(true)
    load(cursor)
      .then((res) => {
        if (res.candles.length < PAGE) setHasMore(false)
        if (res.candles.length > 0) {
          setOlder((prev) => {
            const map = new Map<string, Candle>()
            for (const c of res.candles) map.set(c.bucket_start, c)
            for (const c of prev) map.set(c.bucket_start, c)
            return [...map.values()]
          })
        }
      })
      .catch(() => setHasMore(false))
      .finally(() => setIsLoadingOlder(false))
  }, [load, candles, hasMore, isLoadingOlder])

  return {
    candles,
    loadOlder,
    isLoadingOlder,
    hasMore,
    isLoading: latestQ.isLoading,
    isError: latestQ.isError,
  }
}
