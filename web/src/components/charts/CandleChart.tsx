import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Seg } from "@/components/swiss"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { type Timeframe, TIMEFRAMES } from "@/lib/api"
import { formatDate, formatDateTime, formatTime } from "@/lib/datetime"
import { formatBps } from "@/lib/units"
import { type CandleScope, useCandleSeries } from "@/hooks/useCandleSeries"

// RX/TX colors are user-selectable in Appearance (CSS vars on <html>), so the
// chart re-skins on theme/accent/color change.
const RX_COLOR = "var(--chart-rx)"
const TX_COLOR = "var(--chart-tx)"

type ChartType = "bar" | "line"

const MIN_VISIBLE = 8
const MAX_VISIBLE = 400
const DEFAULT_VISIBLE = 60

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Day-or-longer timeframes label the axis by date; intraday by clock time. */
const isDaily = (tf: Timeframe) => tf === "1d" || tf === "7d" || tf === "1mo"

/** Index of the candle whose timestamp is closest to `target` (ascending). */
function nearestIdx(arr: number[], target: number): number {
  if (arr.length === 0) return 0
  let lo = 0
  let hi = arr.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < target) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(arr[lo - 1] - target) <= Math.abs(arr[lo] - target)) {
    return lo - 1
  }
  return lo
}

interface Row {
  ts: number
  rxRange: [number, number]
  txRange: [number, number]
  rxAvg: number
  txAvg: number
}

interface TipProps {
  active?: boolean
  payload?: { payload: Row }[]
}

function CandleTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div
      className="border-border bg-card text-foreground border p-2 font-mono text-[11px]"
      style={{ borderRadius: 2 }}
    >
      <div className="text-muted-foreground mb-1">{formatDateTime(p.ts)}</div>
      <div style={{ color: RX_COLOR }}>
        RX&nbsp;&nbsp;H {formatBps(p.rxRange[1])} · L {formatBps(p.rxRange[0])} · avg{" "}
        {formatBps(p.rxAvg)}
      </div>
      <div style={{ color: TX_COLOR }}>
        TX&nbsp;&nbsp;H {formatBps(p.txRange[1])} · L {formatBps(p.txRange[0])} · avg{" "}
        {formatBps(p.txAvg)}
      </div>
    </div>
  )
}

interface Props {
  scope: CandleScope
  id: string
  height?: number
}

/**
 * Trading-style OHLC bandwidth chart with interactive navigation.
 *
 * Each candle spans one timeframe window; the floating bar runs the
 * per-second rate's low→high and the line tracks the window average (RX + TX
 * overlaid). Controls (top-right): chart type (bar/line) sits left of the
 * timeframe selector.
 *
 * Navigation:
 *  - **wheel up/down** zooms the visible candle count in/out;
 *  - **wheel left/right** (or **click-drag**) pans through time, lazily
 *    fetching older candles as the left edge is reached;
 *  - the view stays **pinned to the latest** candle (auto-advancing as the
 *    worker flushes each minute) until the user pans back; a "Latest" button
 *    re-pins.
 *
 * Wrapped in `memo` (see export) so the once-per-second live-stats re-renders
 * of the parent card don't cascade a full recharts redraw into the chart —
 * that cascade was the main source of interaction jank.
 */
function CandleChartImpl({ scope, id, height = 260 }: Props) {
  const [tf, setTf] = useState<Timeframe>("1m")
  const [chartType, setChartType] = useState<ChartType>("bar")
  const { candles, loadOlder, isLoadingOlder, hasMore, isLoading, isError } =
    useCandleSeries(scope, id, tf)

  // Horizontal view state: `visibleCount` = zoom; `rightEnd` = the timestamp at
  // the right edge, or null when pinned to the latest candle (auto-advance).
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE)
  const [rightEnd, setRightEnd] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startRight: number | null } | null>(null)
  // Mirror of the live view + data so the (once-subscribed) wheel/drag
  // listeners always read fresh values without re-subscribing each render.
  const viewRef = useRef({ visibleCount, rightEnd, n: 0, tsArr: [] as number[] })
  // Wheel deltas are coalesced and applied once per animation frame so a burst
  // of trackpad events produces one smooth update instead of many janky ones.
  const wheelAccum = useRef({ dy: 0, dx: 0, x: 0 })
  const rafRef = useRef<number | null>(null)
  // Same idea for drag: mousemove can fire faster than the frame rate, so the
  // latest cursor X is applied once per frame rather than re-rendering per event.
  const dragRafRef = useRef<number | null>(null)
  const dragXRef = useRef(0)

  // Reset the view whenever the timeframe changes.
  useEffect(() => {
    setVisibleCount(DEFAULT_VISIBLE)
    setRightEnd(null)
  }, [tf])

  const tsArr = useMemo(
    () => candles.map((c) => new Date(c.bucket_start).getTime()),
    [candles],
  )
  const n = candles.length
  const pinned = rightEnd === null
  const rightIdx = pinned ? n - 1 : nearestIdx(tsArr, rightEnd)
  const end = clamp(rightIdx + 1, 0, n)
  const start = Math.max(0, end - visibleCount)
  viewRef.current = { visibleCount, rightEnd, n, tsArr }

  const data = useMemo<Row[]>(
    () =>
      candles.slice(start, end).map((c) => ({
        ts: new Date(c.bucket_start).getTime(),
        rxRange: [c.rx_low, c.rx_high],
        txRange: [c.tx_low, c.tx_high],
        rxAvg: c.rx_avg,
        txAvg: c.tx_avg,
      })),
    [candles, start, end],
  )

  // True once the chart container is actually rendered (not the loading/empty
  // placeholder) — gates the wheel/drag listeners so they attach to the real
  // node after data arrives, then stay put.
  const chartReady = !isError && data.length > 0

  // Reaching the oldest loaded candle pulls in another page of history.
  useEffect(() => {
    if (!isLoading && hasMore && !isLoadingOlder && n > 0 && start <= 2) {
      loadOlder()
    }
  }, [start, hasMore, isLoadingOlder, isLoading, n, loadOlder])

  // Approx. plot width: container minus the right value-axis (62) + margins.
  const plotInset = 70

  // Zoom anchored to the cursor: the candle under the pointer stays put while
  // the visible count scales — the hallmark of a pro trading chart. `factor`
  // is continuous (proportional to scroll), not a fixed step.
  const applyZoom = useCallback((cursorX: number, factor: number) => {
    const el = containerRef.current
    if (!el) return
    const { visibleCount: vc, rightEnd: re, n: cn, tsArr: ts } = viewRef.current
    if (cn === 0) return
    const plotLeft = 4
    const plotRight = Math.max(plotLeft + 1, el.clientWidth - plotInset)
    const frac = clamp((cursorX - plotLeft) / (plotRight - plotLeft), 0, 1)

    const curRight = re === null ? cn - 1 : nearestIdx(ts, re)
    const curEnd = curRight + 1
    const curStart = Math.max(0, curEnd - vc)
    const curCount = Math.max(1, curEnd - curStart)
    const anchorAbs = curStart + frac * curCount

    const newCount = clamp(Math.round(vc * factor), MIN_VISIBLE, MAX_VISIBLE)
    const newEnd = clamp(
      Math.round(anchorAbs + (1 - frac) * newCount),
      Math.min(newCount, cn),
      cn,
    )
    setVisibleCount(newCount)
    setRightEnd(newEnd - 1 >= cn - 1 ? null : ts[newEnd - 1])
  }, [])

  const applyPanCandles = useCallback((deltaCandles: number) => {
    if (deltaCandles === 0) return
    const { visibleCount: vc, rightEnd: re, n: cn, tsArr: ts } = viewRef.current
    if (cn === 0) return
    const curRight = re === null ? cn - 1 : nearestIdx(ts, re)
    const minRight = Math.min(vc - 1, cn - 1)
    const newRight = clamp(curRight + deltaCandles, minRight, cn - 1)
    setRightEnd(newRight >= cn - 1 ? null : ts[newRight])
  }, [])

  // Wheel: vertical = zoom, horizontal = pan. Coalesced per animation frame for
  // smoothness; non-passive so the page doesn't scroll while interacting.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const a = wheelAccum.current
      a.dy += e.deltaY * scale
      a.dx += e.deltaX * scale
      a.x = e.clientX - el.getBoundingClientRect().left
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          const { dy, dx, x } = wheelAccum.current
          wheelAccum.current = { dy: 0, dx: 0, x: 0 }
          if (Math.abs(dx) > Math.abs(dy) * 1.2) {
            const vc = viewRef.current.visibleCount
            const candleW = Math.max(1, (el.clientWidth - plotInset) / Math.max(1, vc))
            applyPanCandles(Math.round(dx / candleW))
          } else if (dy !== 0) {
            // exp() → smooth multiplicative zoom proportional to scroll amount.
            // Gentle per-frame factor (tight clamp) so each notch eases rather
            // than jumping.
            applyZoom(x, clamp(Math.exp(dy * 0.0015), 0.7, 1.45))
          }
        })
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", onWheel)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [applyZoom, applyPanCandles, chartReady])

  // Click-drag pan, rAF-throttled. Recompute from the drag-start anchor each
  // frame so the view tracks the cursor without accumulating rounding drift.
  useEffect(() => {
    const applyDrag = () => {
      dragRafRef.current = null
      const d = dragRef.current
      const el = containerRef.current
      if (!d || !el) return
      const { visibleCount: vc, n: cn, tsArr: ts } = viewRef.current
      const candleW = Math.max(1, (el.clientWidth - plotInset) / Math.max(1, vc))
      const dxCandles = Math.round((dragXRef.current - d.startX) / candleW)
      const startRightIdx =
        d.startRight === null ? cn - 1 : nearestIdx(ts, d.startRight)
      const minRight = Math.min(vc - 1, cn - 1)
      // Drag right reveals older data → view moves toward the past.
      const newRight = clamp(startRightIdx - dxCandles, minRight, cn - 1)
      setRightEnd(newRight >= cn - 1 ? null : ts[newRight])
    }
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      dragXRef.current = e.clientX
      if (dragRafRef.current == null) {
        dragRafRef.current = requestAnimationFrame(applyDrag)
      }
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      if (dragRafRef.current != null) cancelAnimationFrame(dragRafRef.current)
    }
  }, [chartReady])

  const onMouseDown = (e: React.MouseEvent) => {
    dragXRef.current = e.clientX
    dragRef.current = { startX: e.clientX, startRight: viewRef.current.rightEnd }
  }

  const labelTick = (t: number) => (isDaily(tf) ? formatDate(t) : formatTime(t))

  const toolbar = (
    <div className="flex items-center gap-2">
      {/* Chart-type selector — sits to the LEFT of the timeframe dropdown. */}
      <Seg
        value={chartType}
        options={
          [
            { value: "bar", label: "Bars" },
            { value: "line", label: "Lines" },
          ] as const
        }
        onChange={setChartType}
      />
      {!pinned && (
        <button
          type="button"
          onClick={() => setRightEnd(null)}
          className="border-border text-muted-foreground hover:text-foreground h-7 border px-2 font-mono text-[11px]"
        >
          Latest →
        </button>
      )}
      <Select value={tf} onValueChange={(v) => setTf(v as Timeframe)}>
        <SelectTrigger className="h-7 w-[104px] font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIMEFRAMES.map((t) => (
            <SelectItem key={t.value} value={t.value} className="font-mono text-xs">
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  let body: React.ReactNode
  if (isLoading && n === 0) {
    body = <Skeleton className="rounded-none" style={{ height }} />
  } else if (isError) {
    body = (
      <div
        className="text-destructive border-border flex items-center justify-center border font-mono text-xs"
        style={{ height }}
      >
        Failed to load bandwidth candles.
      </div>
    )
  } else if (data.length === 0) {
    body = (
      <div
        className="text-muted-foreground border-border flex items-center justify-center border font-mono text-xs"
        style={{ height }}
      >
        No candles yet — bandwidth fills in as the worker rolls up each minute.
      </div>
    )
  } else {
    body = (
      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        className="border-border relative cursor-grab touch-none select-none border active:cursor-grabbing"
        style={{ height, background: "var(--card)" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={0}>
            <defs>
              <linearGradient id="candle-rx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={RX_COLOR} stopOpacity={0.4} />
                <stop offset="100%" stopColor={RX_COLOR} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="candle-tx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TX_COLOR} stopOpacity={0.4} />
                <stop offset="100%" stopColor={TX_COLOR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="1 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={labelTick}
              stroke="var(--muted-foreground)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              scale="time"
              minTickGap={28}
            />
            {/* Value axis on the RIGHT, trading-chart style. */}
            <YAxis
              orientation="right"
              tickFormatter={(v: number) => formatBps(v).replace(" ", "")}
              stroke="var(--muted-foreground)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={62}
            />
            <Tooltip
              content={<CandleTooltip />}
              cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
            />
            {chartType === "bar" ? (
              <>
                {/* Bars only — tight side-by-side HL bars (barGap=0 closes the
                    RX/TX gap); maxBarSize keeps them candle-thin at any zoom. */}
                <Bar
                  dataKey="rxRange"
                  name="rx"
                  fill={RX_COLOR}
                  fillOpacity={0.6}
                  isAnimationActive={false}
                  maxBarSize={10}
                />
                <Bar
                  dataKey="txRange"
                  name="tx"
                  fill={TX_COLOR}
                  fillOpacity={0.6}
                  isAnimationActive={false}
                  maxBarSize={10}
                />
              </>
            ) : (
              <>
                {/* Faded area chart of the per-window average rate. */}
                <Area
                  type="monotone"
                  dataKey="rxAvg"
                  name="rx"
                  stroke={RX_COLOR}
                  strokeWidth={1.75}
                  fill="url(#candle-rx)"
                  dot={false}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="txAvg"
                  name="tx"
                  stroke={TX_COLOR}
                  strokeWidth={1.75}
                  fill="url(#candle-tx)"
                  dot={false}
                  isAnimationActive={false}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
        {isLoadingOlder && (
          <span className="text-muted-foreground absolute left-2 top-1 font-mono text-[10px]">
            loading history…
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">{toolbar}</div>
      {body}
    </div>
  )
}

// Props are stable primitives (scope/id/height), so memo cleanly blocks the
// parent's per-second live re-renders from reaching the chart.
export const CandleChart = memo(CandleChartImpl)
