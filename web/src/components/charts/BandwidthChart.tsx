import { useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Seg } from "@/components/swiss"
import type { BandwidthBucket } from "@/lib/api"
import { formatDateTime, formatTime } from "@/lib/datetime"
import { formatBytes } from "@/lib/units"

type ChartVariant = "bar" | "area"

interface Props {
  buckets: BandwidthBucket[]
  height?: number
  /** Initial chart style. The user can flip it with the in-chart toggle;
   *  the choice is remembered across charts and reloads. */
  defaultVariant?: ChartVariant
}

// RX/TX line colors are user-selectable in Appearance and applied as CSS
// vars on <html>, so the chart re-skins automatically on theme/accent/color
// change.
const RX_COLOR = "var(--chart-rx)"
const TX_COLOR = "var(--chart-tx)"

// Persist the bar/area preference so it survives reloads and is shared by
// every BandwidthChart instance the next time they mount.
const VARIANT_KEY = "zv:bwchart:variant"

function loadVariant(fallback: ChartVariant): ChartVariant {
  if (typeof window === "undefined") return fallback
  const v = window.localStorage.getItem(VARIANT_KEY)
  return v === "bar" || v === "area" ? v : fallback
}

/**
 * Per-bucket RX/TX historical chart. Each value is the bytes that flowed
 * *within* one bucket window (hour or day) — not a running total.
 *
 * Two render styles, toggled from the chart's top-right corner:
 *  - `bar`  — side-by-side RX/TX bars, so individual peaks stay readable.
 *  - `area` — filled RX/TX areas, better for reading the overall trend.
 *
 * Note on the "current" bucket: the rightmost point represents an in-flight
 * bucket (the worker re-rolls it every minute), so it grows until the
 * bucket closes — a partial total, not a cumulative artifact.
 */
export function BandwidthChart({ buckets, height = 220, defaultVariant = "bar" }: Props) {
  const [variant, setVariant] = useState<ChartVariant>(() => loadVariant(defaultVariant))

  const changeVariant = (v: ChartVariant) => {
    setVariant(v)
    if (typeof window !== "undefined") window.localStorage.setItem(VARIANT_KEY, v)
  }

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

  // Axis / grid / tooltip config is identical across both variants; recharts
  // wants these as direct children of the chart element, so they're declared
  // once here and spread into each branch below.
  const grid = (
    <CartesianGrid strokeDasharray="1 3" stroke="var(--border)" vertical={false} />
  )
  const xAxis = (
    <XAxis
      dataKey="ts"
      type="number"
      domain={["dataMin", "dataMax"]}
      tickFormatter={(t: number) => formatTime(t)}
      stroke="var(--muted-foreground)"
      fontSize={10}
      tickLine={false}
      axisLine={false}
      scale="time"
    />
  )
  const yAxis = (
    <YAxis
      tickFormatter={(v: number) => formatBytes(v).replace(" ", "")}
      stroke="var(--muted-foreground)"
      fontSize={10}
      tickLine={false}
      axisLine={false}
      width={60}
    />
  )
  const tooltip = (
    <Tooltip
      labelFormatter={(t: unknown) =>
        formatDateTime(typeof t === "number" ? t : Number(t))
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
  )

  return (
    <div className="border-border bg-card border p-2">
      <div className="flex justify-end pb-1">
        <Seg
          value={variant}
          options={
            [
              { value: "bar", label: "Bar" },
              { value: "area", label: "Area" },
            ] as const
          }
          onChange={changeVariant}
        />
      </div>
      <ResponsiveContainer width="100%" height={height}>
        {variant === "area" ? (
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="bw-rx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={RX_COLOR} stopOpacity={0.45} />
                <stop offset="100%" stopColor={RX_COLOR} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="bw-tx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TX_COLOR} stopOpacity={0.45} />
                <stop offset="100%" stopColor={TX_COLOR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            <Area
              type="monotone"
              dataKey="rx"
              name="rx"
              stroke={RX_COLOR}
              strokeWidth={1.5}
              fill="url(#bw-rx)"
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
            <Area
              type="monotone"
              dataKey="tx"
              name="tx"
              stroke={TX_COLOR}
              strokeWidth={1.5}
              fill="url(#bw-tx)"
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
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
        )}
      </ResponsiveContainer>
    </div>
  )
}
