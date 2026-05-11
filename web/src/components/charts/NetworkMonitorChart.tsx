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

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
        <XAxis dataKey="i" hide />
        <YAxis
          tickFormatter={(v: number) => formatRate(v, unit).replace(" ", "")}
          stroke="var(--muted-foreground)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          labelFormatter={() => ""}
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
