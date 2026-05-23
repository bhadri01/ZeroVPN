import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { BandwidthBucket } from "@/lib/api"
import { formatBytes } from "@/lib/units"

interface Props {
  buckets: BandwidthBucket[]
  height?: number
}

// RX/TX line colors are user-selectable in Appearance and applied as CSS
// vars on <html>, so the chart re-skins automatically on theme/accent/color
// change.
const RX_COLOR = "var(--chart-rx)"
const TX_COLOR = "var(--chart-tx)"

/**
 * Per-bucket RX/TX bar chart. Each bar is the bytes that flowed *within*
 * one bucket window (hour or day) — not a running total. Two side-by-side
 * bars per bucket so RX and TX peaks are individually readable instead of
 * one summed area where high-TX/low-RX would visually compress together.
 *
 * Note on the "current" bucket: the rightmost bar represents an in-flight
 * bucket (the worker re-rolls it every minute), so its height grows until
 * the bucket closes. That's not a cumulative artifact — it's just the
 * partial total for the bucket that hasn't ended yet.
 */
export function BandwidthChart({ buckets, height = 220 }: Props) {
  const data = useMemo(
    () =>
      buckets.map((b) => ({
        ts: new Date(b.bucket_start).getTime(),
        rx: b.rx_bytes,
        tx: b.tx_bytes,
      })),
    [buckets],
  )

  if (data.length === 0) {
    return (
      <div
        className="text-muted-foreground border-border flex items-center justify-center border font-mono text-xs"
        style={{ height }}
      >
        No data yet — bandwidth fills in as the worker rolls up samples.
      </div>
    )
  }

  return (
    <div className="border-border bg-card border p-2">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="1 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) =>
              new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
            stroke="var(--muted-foreground)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            scale="time"
          />
          <YAxis
            tickFormatter={(v: number) => formatBytes(v).replace(" ", "")}
            stroke="var(--muted-foreground)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <Tooltip
            labelFormatter={(t: unknown) =>
              new Date(typeof t === "number" ? t : Number(t)).toLocaleString()
            }
            formatter={(v: unknown, name: unknown) =>
              [
                formatBytes(typeof v === "number" ? v : Number(v) || 0),
                String(name) === "rx" ? "RX" : "TX",
              ] as [string, string]
            }
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 2,
              color: "var(--foreground)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
            cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
          />
          <Bar
            dataKey="rx"
            name="rx"
            fill={RX_COLOR}
            isAnimationActive={false}
            radius={[1, 1, 0, 0]}
          />
          <Bar
            dataKey="tx"
            name="tx"
            fill={TX_COLOR}
            isAnimationActive={false}
            radius={[1, 1, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
