import { type ReactNode, memo, useEffect, useMemo, useRef, useState } from "react"
import * as echarts from "echarts/core"
import { CustomChart, LineChart } from "echarts/charts"
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import type { EChartsType } from "echarts/core"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Panel } from "@/components/swiss"
import { type Timeframe, TIMEFRAMES } from "@/lib/api"
import { type CandleScope, useCandleSeries } from "@/hooks/useCandleSeries"
import {
  buildCandleOption,
  CANDLE_MS,
  type ChartType,
  type Colors,
  defaultWindow,
  MIN_VISIBLE,
  type Row,
  type Window,
} from "./candleOption"

echarts.use([
  CustomChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
])

/** Resolve a CSS custom property to a concrete color string the canvas can
 *  paint (rgb/oklch). A probe element converts `var(--x)` to a computed value
 *  so theme/accent changes flow through on re-skin. */
function resolveColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback
  const probe = document.createElement("span")
  probe.style.color = `var(${varName})`
  probe.style.display = "none"
  document.body.appendChild(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c || fallback
}

function readColors(): Colors {
  return {
    rx: resolveColor("--chart-rx", "#3b82f6"),
    tx: resolveColor("--chart-tx", "#f59e0b"),
    border: resolveColor("--border", "#27272a"),
    axis: resolveColor("--muted-foreground", "#71717a"),
    card: resolveColor("--card", "#000"),
    muted: resolveColor("--muted", "#3f3f46"),
  }
}

interface Props {
  scope: CandleScope
  /** Device/server UUID. Omitted for the `user` scope (session-keyed). */
  id?: string
  height?: number
  /** When set, the chart renders inside its own <Panel> with this title/sub and
   *  hangs the toolbar (Latest / Lines-Bars / timeframe) in the header's
   *  right slot — so the controls sit on the same line as the title. Omit for a
   *  bare chart with the toolbar as a row above it (compact/embedded usage). */
  title?: ReactNode
  sub?: ReactNode
}

/**
 * Trading-style OHLC bandwidth chart. Each candle spans one timeframe window;
 * the floating bar runs the per-second rate's low→high and the line tracks the
 * window average (RX + TX overlaid).
 *
 * Rendered with ECharts (canvas) so pan/zoom is handled by its built-in
 * `dataZoom` — buttery on canvas, no per-frame React re-render. Drag pans,
 * wheel zooms; panning to the left edge lazily fetches older candles; the view
 * auto-advances while pinned to the latest candle, and "Latest" re-pins.
 *
 * Wrapped in `memo` so the parent card's per-second live-stats re-renders don't
 * reach the chart.
 */
function CandleChartImpl({ scope, id, height = 260, title, sub }: Props) {
  const [tf, setTf] = useState<Timeframe>("1m")
  // Lines are the default view; switch to candle "Bars" from the toolbar.
  const [chartType, setChartType] = useState<ChartType>("line")
  const [themeTick, setThemeTick] = useState(0)
  const { candles, loadOlder, isLoadingOlder, hasMore, isLoading, isError } =
    useCandleSeries(scope, id ?? "", tf)

  const elRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const zoomRef = useRef<Window | null>(null)
  // Value-axis (bytes) zoom window, set by scrolling over the value gutter.
  const yZoomRef = useRef<Window | null>(null)
  const lastLatestRef = useRef<number | null>(null)

  const rows = useMemo<Row[]>(
    () =>
      candles.map((c) => [
        new Date(c.bucket_start).getTime(),
        c.rx_low,
        c.rx_high,
        c.tx_low,
        c.tx_high,
        c.rx_avg,
        c.tx_avg,
      ]),
    [candles],
  )

  // Live mirrors so the (once-bound) dataZoom listener reads fresh values.
  const stateRef = useRef({ rows, hasMore, isLoadingOlder, loadOlder })
  stateRef.current = { rows, hasMore, isLoadingOlder, loadOlder }

  const n = rows.length
  const ready = !isError && !(isLoading && n === 0) && n > 0

  // Reset the view when the timeframe changes.
  useEffect(() => {
    zoomRef.current = null
    lastLatestRef.current = null
  }, [tf])

  // Re-skin on theme / accent / color change (CSS vars on <html>).
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((t) => t + 1))
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    })
    return () => obs.disconnect()
  }, [])

  // Create the ECharts instance once the container exists; wire resize + the
  // dataZoom listener (which captures the user's window and lazily pages in
  // older history when panning to the left edge).
  useEffect(() => {
    if (!ready) return
    const el = elRef.current
    if (!el) return
    const chart = echarts.init(el, null, { renderer: "canvas" })
    chartRef.current = chart

    type DZ = { id?: string; startValue?: number; endValue?: number }
    const onZoom = () => {
      const opt = chart.getOption() as { dataZoom?: DZ[] }
      const list = opt.dataZoom ?? []
      const dzx = list.find((d) => d.id === "dzX") ?? list[0]
      if (dzx?.startValue != null && dzx.endValue != null) {
        zoomRef.current = { startValue: dzx.startValue, endValue: dzx.endValue }
        const s = stateRef.current
        const earliest = s.rows[0]?.[0]
        if (
          earliest != null &&
          dzx.startValue <= earliest + CANDLE_MS[tf] * 4 &&
          s.hasMore &&
          !s.isLoadingOlder
        ) {
          s.loadOlder()
        }
      }
    }
    chart.on("datazoom", onZoom)

    // All wheel input is handled here (non-passive + capture) so the speed is
    // tame — ECharts' built-in wheel zoom steps far too coarsely:
    //  · over the value-axis gutter → scale the bytes range, cursor-anchored
    //  · over the plot, vertical scroll / pinch → zoom the time window
    //  · over the plot, horizontal scroll → pan, ~1:1 with the pointer
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      e.preventDefault()
      e.stopPropagation()
      const norm = (d: number) =>
        e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * 400 : d
      if (x >= rect.width - 72) {
        // Value-axis gutter: rescale the bytes range, anchored at the cursor.
        const y = e.clientY - rect.top
        const conv = (py: number) => {
          const v = chart.convertFromPixel({ gridIndex: 0 }, [x, py]) as
            | number[]
            | null
          return Array.isArray(v) ? v[1] : NaN
        }
        const topV = conv(8)
        const botV = conv(rect.height - 22)
        const curV = conv(y)
        const span = topV - botV
        if (!isFinite(span) || span <= 0 || !isFinite(curV)) return
        const dy = norm(e.deltaY)
        // Up (deltaY<0) → factor<1 → smaller range → zoom into finer detail.
        const factor = Math.min(1.8, Math.max(0.55, Math.exp(dy * 0.0012)))
        const frac = (curV - botV) / span
        const newSpan = span * factor
        let newBot = curV - frac * newSpan
        let newTop = newBot + newSpan
        if (newBot < 0) {
          newTop -= newBot
          newBot = 0
        }
        yZoomRef.current = { startValue: newBot, endValue: newTop }
        chart.setOption({ yAxis: { min: newBot, max: newTop } })
        return
      }
      // Time axis. Work from the current window + loaded data extent.
      const w = zoomRef.current
      const s = stateRef.current
      const nRows = s.rows.length
      if (!w || nRows === 0) return
      const span = w.endValue - w.startValue
      if (!(span > 0)) return
      const earliest = s.rows[0][0]
      const latest = s.rows[nRows - 1][0]
      const pad = CANDLE_MS[tf]
      const minSpan = CANDLE_MS[tf] * MIN_VISIBLE
      const maxSpan = Math.max(latest - earliest + pad * 2, minSpan)
      const dx = norm(e.deltaX)
      const dy = norm(e.deltaY)
      let next: Window
      if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal scroll pans at drag speed: one pixel of scroll moves the
        // window one pixel's worth of time.
        const plotW = Math.max(1, rect.width - 70) // grid left + right margins
        const dt = dx * (span / plotW)
        next = { startValue: w.startValue + dt, endValue: w.endValue + dt }
      } else {
        // Vertical scroll zooms, anchored at the cursor's timestamp. Pinch
        // (ctrlKey) sends tiny deltas, so it gets a stronger coefficient.
        const k = e.ctrlKey ? 0.005 : 0.0008
        const factor = Math.min(1.35, Math.max(0.75, Math.exp(dy * k)))
        const newSpan = Math.min(maxSpan, Math.max(minSpan, span * factor))
        const p = chart.convertFromPixel({ gridIndex: 0 }, [x, 10]) as
          | number[]
          | null
        const anchor =
          Array.isArray(p) && isFinite(p[0]) ? p[0] : w.startValue + span / 2
        const frac = Math.min(1, Math.max(0, (anchor - w.startValue) / span))
        const start = anchor - frac * newSpan
        next = { startValue: start, endValue: start + newSpan }
      }
      // Keep the window inside the loaded data (one candle of pad each side);
      // reaching the left edge triggers the datazoom handler's lazy history
      // load, which extends `earliest` and lets the next tick continue.
      if (next.endValue > latest + pad) {
        const d = next.endValue - (latest + pad)
        next = { startValue: next.startValue - d, endValue: next.endValue - d }
      }
      if (next.startValue < earliest - pad) {
        const d = earliest - pad - next.startValue
        next = {
          startValue: next.startValue + d,
          endValue: Math.min(next.endValue + d, latest + pad),
        }
      }
      zoomRef.current = next
      chart.dispatchAction({ type: "dataZoom", dataZoomId: "dzX", ...next })
    }
    el.addEventListener("wheel", onWheel, { capture: true, passive: false })

    // Value-axis drag-to-scale (TradingView price-axis style): press on the
    // bytes gutter and drag — up stretches the scale (zoom in), down compresses
    // it (zoom out), anchored at the grab point. Recomputed from the grab state
    // each move so there's no drift.
    const convY = (px: number, py: number) => {
      const v = chart.convertFromPixel({ gridIndex: 0 }, [px, py]) as number[] | null
      return Array.isArray(v) ? v[1] : NaN
    }
    const drag = { active: false, startY: 0, span0: 0, anchor: 0, frac: 0 }
    const onDragMove = (e: MouseEvent) => {
      if (!drag.active) return
      e.preventDefault()
      const dy = e.clientY - drag.startY // up → negative → zoom in
      const factor = Math.min(5, Math.max(0.2, Math.exp(dy * 0.004)))
      const newSpan = drag.span0 * factor
      let newBot = drag.anchor - drag.frac * newSpan
      let newTop = newBot + newSpan
      if (newBot < 0) {
        newTop -= newBot
        newBot = 0
      }
      yZoomRef.current = { startValue: newBot, endValue: newTop }
      chart.setOption({ yAxis: { min: newBot, max: newTop } })
    }
    const onDragUp = () => {
      drag.active = false
      window.removeEventListener("mousemove", onDragMove)
      window.removeEventListener("mouseup", onDragUp)
    }
    const onDown = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      if (x < rect.width - 72) return // only the value-axis gutter
      const topV = convY(x, 8)
      const botV = convY(x, rect.height - 22)
      const anchor = convY(x, e.clientY - rect.top)
      const span0 = topV - botV
      if (!isFinite(span0) || span0 <= 0 || !isFinite(anchor)) return
      e.preventDefault()
      e.stopPropagation() // keep ECharts from starting an x-axis pan
      drag.active = true
      drag.startY = e.clientY
      drag.span0 = span0
      drag.anchor = anchor
      drag.frac = (anchor - botV) / span0
      window.addEventListener("mousemove", onDragMove)
      window.addEventListener("mouseup", onDragUp)
    }
    el.addEventListener("mousedown", onDown, { capture: true })

    // ns-resize cursor over the gutter so the drag affordance is discoverable.
    const onHover = (e: MouseEvent) => {
      if (drag.active) return
      const rect = el.getBoundingClientRect()
      el.style.cursor = e.clientX - rect.left >= rect.width - 72 ? "ns-resize" : ""
    }
    el.addEventListener("mousemove", onHover)

    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)

    return () => {
      ro.disconnect()
      el.removeEventListener("wheel", onWheel, { capture: true })
      el.removeEventListener("mousedown", onDown, { capture: true })
      el.removeEventListener("mousemove", onHover)
      window.removeEventListener("mousemove", onDragMove)
      window.removeEventListener("mouseup", onDragUp)
      chart.off("datazoom", onZoom)
      chart.dispose()
      chartRef.current = null
    }
    // Recreate only when the chart appears/disappears or timeframe changes.
  }, [ready, tf])

  // Push data / option updates. Preserves the user's window; auto-advances it
  // when pinned to the latest candle so live candles keep scrolling in.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || n === 0) return

    const latest = rows[n - 1][0]
    if (zoomRef.current == null) {
      zoomRef.current = defaultWindow(rows, tf)
    } else if (lastLatestRef.current != null && latest > lastLatestRef.current) {
      // New candle(s) arrived — if the view was pinned to the previous latest,
      // slide the window forward to keep tracking live.
      const w = zoomRef.current
      if (w.endValue >= lastLatestRef.current - CANDLE_MS[tf]) {
        zoomRef.current = { startValue: w.startValue + (latest - w.endValue), endValue: latest }
      }
    }
    lastLatestRef.current = latest

    const colors = readColors()
    // yZoomRef (if set) flows into yAxis.min/max so the user's manual value-axis
    // scale survives live refreshes; null lets the axis auto-fit the data.
    const option = buildCandleOption(rows, {
      tf,
      chartType,
      colors,
      yWindow: yZoomRef.current,
    })
    if (zoomRef.current) {
      option.dataZoom[0] = {
        ...option.dataZoom[0],
        ...zoomRef.current,
      } as (typeof option.dataZoom)[0]
    }
    chart.setOption(option, { replaceMerge: ["series"] })
  }, [rows, n, chartType, tf, themeTick])

  const onLatest = () => {
    zoomRef.current = defaultWindow(rows, tf)
    yZoomRef.current = null // refit the value axis to the data
    const chart = chartRef.current
    if (chart) {
      if (zoomRef.current) {
        chart.dispatchAction({ type: "dataZoom", dataZoomId: "dzX", ...zoomRef.current })
      }
      // Refit the value axis to the data (clears any manual scale).
      chart.setOption({ yAxis: { min: 0, max: null } })
    }
  }

  const toolbar = (
    <div className="flex items-center gap-2">
      {/* Order, left → right: Latest · chart style · timeframe. */}
      <button
        type="button"
        onClick={onLatest}
        className="border-border text-muted-foreground hover:text-foreground h-7 border px-2 font-mono text-[11px]"
      >
        Latest →
      </button>
      <Select
        value={chartType}
        onValueChange={(v) => setChartType(v as ChartType)}
      >
        <SelectTrigger className="h-7 w-[92px] font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="line" className="font-mono text-xs">
            Lines
          </SelectItem>
          <SelectItem value="bar" className="font-mono text-xs">
            Bars
          </SelectItem>
        </SelectContent>
      </Select>
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
  } else if (n === 0) {
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
        className="border-border relative cursor-grab touch-none select-none border active:cursor-grabbing"
        style={{ height, background: "var(--card)" }}
      >
        <div ref={elRef} className="h-full w-full" />
        {isLoadingOlder && (
          <span className="text-muted-foreground absolute left-2 top-1 z-10 font-mono text-[10px]">
            loading history…
          </span>
        )}
      </div>
    )
  }

  // With a title, own the panel and hang the toolbar in the header's right
  // slot so the controls sit on the same line as the title. Without one, fall
  // back to a bare toolbar row above the chart (compact/embedded usage).
  if (title != null || sub != null) {
    return (
      <Panel title={title} sub={sub} right={toolbar}>
        {body}
      </Panel>
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
