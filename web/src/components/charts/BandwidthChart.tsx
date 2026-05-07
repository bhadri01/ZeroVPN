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
        className="text-muted-foreground flex items-center justify-center rounded-lg border text-sm"
        style={{ height }}
      >
        No data yet — bandwidth fills in as the worker rolls up samples.
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-2">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="bw-rx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="bw-tx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.18)" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) =>
              new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
            stroke="rgba(120,120,120,0.7)"
            fontSize={10}
            scale="time"
          />
          <YAxis
            tickFormatter={(v: number) => formatBytes(v).replace(" ", "")}
            stroke="rgba(120,120,120,0.7)"
            fontSize={10}
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
              background: "rgba(20,20,20,0.92)",
              border: "1px solid rgba(120,120,120,0.3)",
              borderRadius: 6,
              color: "white",
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="rx"
            name="RX"
            stroke="#3b82f6"
            fill="url(#bw-rx)"
            strokeWidth={1.6}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="tx"
            name="TX"
            stroke="#22c55e"
            fill="url(#bw-tx)"
            strokeWidth={1.6}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
