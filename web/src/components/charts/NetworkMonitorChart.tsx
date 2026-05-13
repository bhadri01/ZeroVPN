import { useMemo } from "react"
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

interface Props {
  rxHistory: number[]
  txHistory: number[]
  height?: number
  /**
   * - "combined": render both RX and TX
   * - "rx" | "tx": render only one series
   */
  variant?: "combined" | "rx" | "tx"
  /** "bps" prints kbps/Mbps; "Bps" prints kB/s/MB/s. Default "bps". */
  unit?: "bps" | "Bps"
  /** When set, renders an X axis with relative-time tick labels
   *  ("-5m", "-4m", … "now"). Pass the *intended* window in seconds —
   *  the labels are computed from that, not from the array length, so
   *  the axis stays stable as the chart fills up. */
  windowSec?: number
}

function formatRate(n: number, unit: "bps" | "Bps"): string {
  const u = unit === "Bps" ? "B/s" : "bps"
  const k = unit === "Bps" ? "kB/s" : "kbps"
  const m = unit === "Bps" ? "MB/s" : "Mbps"
  const g = unit === "Bps" ? "GB/s" : "Gbps"
  if (n < 1_000) return `${Math.round(n)} ${u}`
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)} ${k}`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} ${m}`
  return `${(n / 1_000_000_000).toFixed(2)} ${g}`
}

// Swiss palette: cobalt RX, lime TX. Aligns with BandwidthChart so a
// glance at any chart in the app reads the same way.
const RX_COLOR = "var(--chart-1)"
const TX_COLOR = "var(--primary)"

/**
 * Live rolling-window dual-area chart. Plots whatever `rxHistory` /
 * `txHistory` arrays are passed in — the live store caps them at
 * HISTORY_CAP frames (30 min at 1 Hz). Used on Dashboard and DeviceDetail
 * and admin/Overview; the BandwidthChart sibling is for historical bucket
 * data instead.
 *
 * Both series share an unlabelled X axis (frames are evenly spaced —
 * the actual interval is whatever the backend emits) and a Y axis
 * formatted in the chosen unit. Gradient fills, hairline strokes,
 * `isAnimationActive=false` so streaming updates don't redraw.
 */
export function NetworkMonitorChart({
  rxHistory,
  txHistory,
  height = 220,
  variant = "combined",
  unit = "bps",
  windowSec,
}: Props) {
  const data = useMemo(() => {
    const len = Math.max(rxHistory.length, txHistory.length)
    const out: { i: number; rx: number; tx: number }[] = []
    for (let i = 0; i < len; i++) {
      out.push({
        i,
        rx: rxHistory[i] ?? 0,
        tx: txHistory[i] ?? 0,
      })
    }
    return out
  }, [rxHistory, txHistory])

  // Build the relative-time tick set when a window is given. The X
  // labels span `[-windowSec, 0]` ("now") at one tick per minute, with
  // the assumption that each frame is 1 second wide (matches what the
  // live store + hydration produce). Labels are pinned to the window —
  // not to data.length — so the axis doesn't visually slide while the
  // chart fills up after mount.
  const ticks = useMemo<number[]>(() => {
    if (!windowSec || windowSec <= 0) return []
    const out: number[] = []
    const step = windowSec >= 600 ? 120 : 60 // ≥10m → 2-min ticks
    for (let s = 0; s <= windowSec; s += step) {
      out.push(windowSec - s)
    }
    return out
  }, [windowSec])
  const formatTick = (i: number): string => {
    if (!windowSec) return ""
    const secAgo = windowSec - i
    if (secAgo === 0) return "now"
    if (secAgo < 60) return `-${secAgo}s`
    return `-${Math.round(secAgo / 60)}m`
  }
  const showXAxis = !!windowSec && windowSec > 0

  if (data.length === 0) {
    return (
      <div
        className="text-muted-foreground border-border flex items-center justify-center border font-mono text-xs"
        style={{ height }}
      >
        Waiting for live data…
      </div>
    )
  }

  // When showing the time axis, right-align the data inside the window
  // so frames live at indices `[windowSec - len .. windowSec]`. That way
  // a half-full chart still anchors "now" to the right edge instead of
  // squashing 10 frames into the leftmost slot.
  const plotData = useMemo(() => {
    if (!showXAxis || !windowSec) return data
    const offset = windowSec - data.length
    return data.map((d, idx) => ({ ...d, i: offset + idx }))
  }, [data, showXAxis, windowSec])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={plotData} margin={{ top: 8, right: 8, left: 0, bottom: showXAxis ? 4 : 0 }}>
        <defs>
          <linearGradient id="nm-rx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={RX_COLOR} stopOpacity={0.45} />
            <stop offset="100%" stopColor={RX_COLOR} stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="nm-tx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TX_COLOR} stopOpacity={0.45} />
            <stop offset="100%" stopColor={TX_COLOR} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        {showXAxis ? (
          <XAxis
            dataKey="i"
            type="number"
            domain={[0, windowSec ?? 0]}
            ticks={ticks}
            tickFormatter={formatTick}
            stroke="var(--muted-foreground)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            interval={0}
            minTickGap={20}
            height={20}
          />
        ) : (
          <XAxis dataKey="i" hide />
        )}
        <YAxis
          tickFormatter={(v: number) => formatRate(v, unit).replace(" ", "")}
          stroke="var(--muted-foreground)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          labelFormatter={(label) =>
            showXAxis ? formatTick(Number(label) || 0) : ""
          }
          formatter={(v: unknown, name: unknown) =>
            [
              formatRate(typeof v === "number" ? v : Number(v) || 0, unit),
              String(name).toUpperCase(),
            ] as [string, string]
          }
          contentStyle={{
            background: "var(--card)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            borderRadius: 2,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            padding: "4px 8px",
          }}
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "2 2" }}
        />
        {(variant === "combined" || variant === "rx") && (
          <Area
            type="monotone"
            dataKey="rx"
            name="rx"
            stroke={RX_COLOR}
            fill="url(#nm-rx)"
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        )}
        {(variant === "combined" || variant === "tx") && (
          <Area
            type="monotone"
            dataKey="tx"
            name="tx"
            stroke={TX_COLOR}
            fill="url(#nm-tx)"
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}

/**
 * Tiny pulse indicator for "this chart is live". Pair with the chart's
 * card header.
 */
export function LiveIndicator() {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em]">
      <span className="zv-live-dot" />
      Live
    </span>
  )
}
