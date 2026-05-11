import { useMemo } from "react"
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts"

interface Props {
  rxHistory: number[]
  txHistory: number[]
  height?: number
}

// Swiss palette — cobalt RX, lime TX, matched to BandwidthChart.
const RX_COLOR = "var(--chart-1)"
const TX_COLOR = "var(--primary)"

// Headroom above the rolling-window peak so the trace never touches the top.
const PEAK_HEADROOM = 1.15
// Minimum domain so an idle chart isn't flat-lined against a zero ceiling.
const MIN_DOMAIN = 1024 // 1 kbps

/**
 * Tiny presentational sparkline. No axes visible, no grid, no tooltip —
 * just two faint stacked areas. Intended for the sidebar footer; takes
 * whatever width its parent gives it, defaults to 60 px tall.
 *
 * Smoothness notes:
 * - The caller pads `rxHistory` / `txHistory` to a fixed length (see
 *   `aggregateLiveStats(devices, window)`), so the X axis never re-maps
 *   as new frames arrive — the trace slides instead of stretching.
 * - The Y axis is pinned to the max of the *current visible window*
 *   rather than letting Recharts auto-fit to each render's data. This
 *   eliminates the per-tick rescale flicker that was the loudest visual
 *   stutter; the ceiling only moves when a new in-window peak arrives or
 *   an old one rolls off.
 * - `type="linear"` instead of `monotone` — Bézier-smoothed traces
 *   wobble noticeably at this tiny height when adjacent points are far
 *   apart, which reads as flicker.
 */
export function MiniAreaChart({
  rxHistory,
  txHistory,
  height = 60,
}: Props) {
  const data = useMemo(() => {
    const len = Math.max(rxHistory.length, txHistory.length)
    const out: { i: number; rx: number; tx: number }[] = []
    for (let i = 0; i < len; i++) {
      out.push({ i, rx: rxHistory[i] ?? 0, tx: txHistory[i] ?? 0 })
    }
    return out
  }, [rxHistory, txHistory])

  const yMax = useMemo(() => {
    let raw = MIN_DOMAIN
    for (const p of data) {
      if (p.rx > raw) raw = p.rx
      if (p.tx > raw) raw = p.tx
    }
    return raw * PEAK_HEADROOM
  }, [data])

  if (data.length === 0) {
    return <div className="bg-muted/40" style={{ height }} aria-hidden />
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 1, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="mini-rx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={RX_COLOR} stopOpacity={0.5} />
            <stop offset="100%" stopColor={RX_COLOR} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="mini-tx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TX_COLOR} stopOpacity={0.5} />
            <stop offset="100%" stopColor={TX_COLOR} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <YAxis
          hide
          domain={[0, yMax]}
          allowDataOverflow={false}
        />
        <Area
          type="linear"
          dataKey="rx"
          stroke={RX_COLOR}
          strokeWidth={1}
          fill="url(#mini-rx)"
          isAnimationActive={false}
          dot={false}
          activeDot={false}
        />
        <Area
          type="linear"
          dataKey="tx"
          stroke={TX_COLOR}
          strokeWidth={1}
          fill="url(#mini-tx)"
          isAnimationActive={false}
          dot={false}
          activeDot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
