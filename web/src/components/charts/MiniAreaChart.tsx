import { useMemo } from "react"
import { Area, AreaChart, ResponsiveContainer } from "recharts"

interface Props {
  rxHistory: number[]
  txHistory: number[]
  height?: number
}

// Swiss palette — cobalt RX, lime TX, matched to BandwidthChart.
const RX_COLOR = "var(--chart-1)"
const TX_COLOR = "var(--primary)"

/**
 * Tiny presentational sparkline. No axes, no grid, no tooltip — just two
 * faint stacked areas. Intended for the sidebar footer; takes whatever
 * width its parent gives it, defaults to 60 px tall.
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
        <Area
          type="monotone"
          dataKey="rx"
          stroke={RX_COLOR}
          strokeWidth={1}
          fill="url(#mini-rx)"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="tx"
          stroke={TX_COLOR}
          strokeWidth={1}
          fill="url(#mini-tx)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
