import type {
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemParams,
  CustomSeriesRenderItemReturn,
} from "echarts"

import type { Timeframe } from "@/lib/api"
import { formatDate, formatDateTime, formatTime } from "@/lib/datetime"
import { formatBps } from "@/lib/units"

export type ChartType = "bar" | "line"

const DEFAULT_VISIBLE = 60

/** Zoom-in floor: never show fewer than this many candles. One candle is the
 *  finest data we have (per-second rates rolled into one timeframe window), so
 *  zooming past it only reveals empty space. */
export const MIN_VISIBLE = 5

/** Wall-clock duration of one candle for each timeframe (ms). */
export const CANDLE_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
  "7d": 604_800_000,
  "1mo": 2_592_000_000,
}

/** Day-or-longer timeframes label the axis by date; intraday by clock time. */
const isDaily = (tf: Timeframe) => tf === "1d" || tf === "7d" || tf === "1mo"

/** One row of the chart: [ts, rxLow, rxHigh, txLow, txHigh, rxAvg, txAvg]. */
export type Row = [number, number, number, number, number, number, number]

export interface Colors {
  rx: string
  tx: string
  border: string
  axis: string
  card: string
  muted: string
}

export interface Window {
  startValue: number
  endValue: number
}

/** Default view: the latest `DEFAULT_VISIBLE` candles of the loaded series. */
export function defaultWindow(rows: Row[], tf: Timeframe): Window | null {
  if (rows.length === 0) return null
  const end = rows[rows.length - 1][0]
  return { startValue: end - DEFAULT_VISIBLE * CANDLE_MS[tf], endValue: end }
}

/**
 * Build the ECharts option for the candle chart. Pure (colors are passed in,
 * no DOM access) so it can be unit-rendered headlessly to verify layout. RX/TX
 * render as side-by-side low→high range bars (custom series) or as average-rate
 * area lines; the value axis sits on the right.
 */
export function buildCandleOption(
  rows: Row[],
  opts: {
    tf: Timeframe
    chartType: ChartType
    colors: Colors
    /** Manual value-axis range (set by scaling over the right gutter). When
     *  null the axis auto-fits the visible data (`min: 0` .. `dataMax`). */
    yWindow?: Window | null
  }
) {
  const { tf, chartType, colors, yWindow } = opts
  const daily = isDaily(tf)

  const rangeRenderItem = (
    _params: CustomSeriesRenderItemParams,
    api: CustomSeriesRenderItemAPI
  ): CustomSeriesRenderItemReturn => {
    const ts = api.value(0) as number
    const x = api.coord([ts, 0])[0]
    // Pixel width of one candle window; the two bars split it.
    const sizeRaw = api.size?.([CANDLE_MS[tf], 0])
    const band = Math.abs(Array.isArray(sizeRaw) ? sizeRaw[0] : (sizeRaw ?? 6))
    const barW = Math.max(1, Math.min(9, band * 0.42))
    const gap = Math.max(0.5, barW * 0.12)

    const rxHigh = api.coord([ts, api.value(2) as number])[1]
    const rxLow = api.coord([ts, api.value(1) as number])[1]
    const txHigh = api.coord([ts, api.value(4) as number])[1]
    const txLow = api.coord([ts, api.value(3) as number])[1]

    return {
      type: "group",
      children: [
        {
          type: "rect",
          shape: {
            x: x - barW - gap / 2,
            y: rxHigh,
            width: barW,
            height: Math.max(1, rxLow - rxHigh),
          },
          style: { fill: colors.rx, opacity: 0.65 },
        },
        {
          type: "rect",
          shape: {
            x: x + gap / 2,
            y: txHigh,
            width: barW,
            height: Math.max(1, txLow - txHigh),
          },
          style: { fill: colors.tx, opacity: 0.65 },
        },
      ],
    }
  }

  const barSeries = [
    {
      type: "custom" as const,
      name: "candles",
      renderItem: rangeRenderItem,
      encode: { x: 0, y: [1, 2, 3, 4] },
      data: rows,
      clip: true,
      z: 2,
    },
  ]

  const lineSeries = [
    {
      type: "line" as const,
      name: "rx",
      showSymbol: false,
      smooth: true,
      lineStyle: { color: colors.rx, width: 1.75 },
      areaStyle: { color: colors.rx, opacity: 0.12 },
      encode: { x: 0, y: 5 },
      data: rows,
      clip: true,
      z: 2,
    },
    {
      type: "line" as const,
      name: "tx",
      showSymbol: false,
      smooth: true,
      lineStyle: { color: colors.tx, width: 1.75 },
      areaStyle: { color: colors.tx, opacity: 0.12 },
      encode: { x: 0, y: 6 },
      data: rows,
      clip: true,
      z: 2,
    },
  ]

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { top: 8, right: 64, bottom: 22, left: 6 },
    tooltip: {
      trigger: "axis" as const,
      // Crosshair that follows the cursor, with a value readout on the bytes
      // axis and a time readout on the x axis (TradingView-style).
      axisPointer: {
        type: "cross" as const,
        lineStyle: {
          color: colors.axis,
          width: 1,
          opacity: 0.5,
          type: "dashed" as const,
        },
        crossStyle: {
          color: colors.axis,
          width: 1,
          opacity: 0.5,
          type: "dashed" as const,
        },
        label: {
          backgroundColor: colors.muted,
          color: colors.axis,
          borderColor: colors.border,
          borderWidth: 1,
          fontFamily: "monospace",
          fontSize: 10,
        },
      },
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      padding: 8,
      textStyle: { color: colors.axis, fontSize: 11, fontFamily: "monospace" },
      formatter: (args: unknown) => {
        const list = Array.isArray(args) ? args : [args]
        const v = (list[0] as { value?: Row } | undefined)?.value
        if (!v) return ""
        const line = (
          label: string,
          color: string,
          lo: number,
          hi: number,
          avg: number
        ) =>
          `<div style="color:${color}">${label}&nbsp;&nbsp;H ${formatBps(hi)} · L ${formatBps(lo)} · avg ${formatBps(avg)}</div>`
        return (
          `<div style="color:${colors.axis};margin-bottom:4px">${formatDateTime(v[0])}</div>` +
          line("RX", colors.rx, v[1], v[2], v[5]) +
          line("TX", colors.tx, v[3], v[4], v[6])
        )
      },
    },
    xAxis: {
      type: "time" as const,
      // Never place ticks denser than one candle — the label format is
      // minute/date-granular, so sub-candle ticks render as duplicates
      // ("11:53 11:53 11:53").
      minInterval: CANDLE_MS[tf],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: colors.axis,
        fontSize: 10,
        fontFamily: "monospace",
        hideOverlap: true,
        formatter: (val: number) => (daily ? formatDate(val) : formatTime(val)),
      },
      axisPointer: {
        label: {
          formatter: (p: { value: number | string }) =>
            daily ? formatDate(Number(p.value)) : formatTime(Number(p.value)),
        },
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value" as const,
      position: "right" as const,
      // The value-axis range is scaled manually (wheel / drag over the right
      // gutter) by setting min/max directly — NOT via a y dataZoom, which would
      // clamp zoom-out to the data extent [0, dataMax] and stop you from
      // shrinking the candles past the tallest one. `null` max = auto-fit.
      min: yWindow ? yWindow.startValue : 0,
      max: yWindow ? yWindow.endValue : null,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: colors.axis,
        fontSize: 10,
        fontFamily: "monospace",
        formatter: (val: number) => formatBps(val).replace(" ", ""),
      },
      // Value readout that tracks the cursor's Y on the bytes axis.
      axisPointer: {
        label: {
          formatter: (p: { value: number | string }) =>
            formatBps(Number(p.value)).replace(" ", ""),
        },
      },
      splitLine: {
        lineStyle: {
          color: colors.border,
          type: "dashed" as const,
          opacity: 0.6,
        },
      },
    },
    dataZoom: [
      {
        // Time axis: drag pans; the wheel is handled by CandleChart's own
        // listener (gentler steps than ECharts' built-in wheel zoom, with a
        // pan/zoom split for trackpads), which dispatches dataZoom actions
        // here. The value axis has no dataZoom — it's scaled by setting
        // yAxis.min/max directly (see the wheel/drag handlers in CandleChart)
        // so zoom-out isn't capped at the data extent the way a dataZoom
        // would cap it.
        id: "dzX",
        type: "inside" as const,
        xAxisIndex: 0,
        filterMode: "filter" as const,
        zoomOnMouseWheel: false,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        minValueSpan: CANDLE_MS[tf] * MIN_VISIBLE,
        throttle: 30,
      },
    ],
    series: chartType === "bar" ? barSeries : lineSeries,
  }
}
