import { useMemo } from "react"
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts"

interface Props {
  rxHistory: number[]
  txHistory: number[]
  height?: number
}

// RX/TX colors are user-selectable in Appearance (CSS vars on <html>).
const RX_COLOR = "var(--chart-rx)"
const TX_COLOR = "var(--chart-tx)"

// Headroom above the scale base so the trace never touches the top.
const PEAK_HEADROOM = 1.25
// Minimum domain so an idle chart isn't flat-lined against a zero ceiling.
const MIN_DOMAIN = 1024 // 1 kbps
// Percentile of the visible window used as the y-axis base. Using the raw
// max means one big spike flattens the rest of the trace into a thin
// strip at the bottom — exactly the "no chart movement" symptom this
// fixes. P90 captures most of the typical-traffic range while letting a
// real spike clip at the top (which `allowDataOverflow` keeps clipped
// visually instead of re-stretching the scale).
const SCALE_PERCENTILE = 0.9

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
    // Collect nonzero rx/tx samples from the visible window; both series
    // share the y-axis so they stay visually comparable. Filtering
    // zeros keeps idle stretches from dragging the percentile down to
    // near-zero and re-flattening the chart the moment traffic starts.
    const all: number[] = []
    for (const p of data) {
      if (p.rx > 0) all.push(p.rx)
      if (p.tx > 0) all.push(p.tx)
    }
    if (all.length === 0) return MIN_DOMAIN * PEAK_HEADROOM
    all.sort((a, b) => a - b)
    const idx = Math.min(
      all.length - 1,
      Math.floor(all.length * SCALE_PERCENTILE),
    )
    const base = all[idx] ?? all[all.length - 1]
    // Also blend with mean × 4 so a long flat stretch with one spike
    // doesn't pin p90 to a single outlier value — the mean keeps the
    // ceiling closer to "typical activity" and gives the trace real
    // vertical movement instead of a thin baseline strip.
    const mean = all.reduce((s, v) => s + v, 0) / all.length
    const blended = Math.max(base, mean * 4)
    return Math.max(blended * PEAK_HEADROOM, MIN_DOMAIN)
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
          // Spikes above the p90-based ceiling clip at the top of the
          // chart instead of re-stretching the scale — preserves
          // visible movement in the typical-traffic band below.
          allowDataOverflow
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
