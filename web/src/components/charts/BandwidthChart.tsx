import { useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { BandwidthBucket } from "@/lib/api"

interface Props {
  buckets: BandwidthBucket[]
  height?: number
}

function formatBytes(n: number): string {
  if (n < 1_000) return `${n} B`
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)} kB`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
  return `${(n / 1_000_000_000).toFixed(2)} GB`
}

// Swiss palette: cobalt-blue RX, lime TX. Pulled via CSS vars so the
// chart re-skins automatically on theme switch.
const RX_COLOR = "var(--chart-1)"
const TX_COLOR = "var(--primary)"

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
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="bw-rx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={RX_COLOR} stopOpacity={0.4} />
              <stop offset="100%" stopColor={RX_COLOR} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="bw-tx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TX_COLOR} stopOpacity={0.4} />
              <stop offset="100%" stopColor={TX_COLOR} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="1 3" stroke="var(--border)" />
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
            cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "2 2" }}
          />
          <Area
            type="monotone"
            dataKey="rx"
            name="RX"
            stroke={RX_COLOR}
            fill="url(#bw-rx)"
            strokeWidth={1.4}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="tx"
            name="TX"
            stroke={TX_COLOR}
            fill="url(#bw-tx)"
            strokeWidth={1.4}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
