import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { BandwidthChart } from "@/components/charts/LazyBandwidthChart"
import { Kpi, KpiStrip, PageHead, Panel, Seg } from "@/components/swiss"
import { Skeleton } from "@/components/ui/skeleton"
import { type BandwidthRange, userBandwidth } from "@/lib/api"
import { formatBytes } from "@/lib/units"

export function BandwidthPage() {
  const [range, setRange] = useState<BandwidthRange>("24h")

  const bwQ = useQuery({
    queryKey: ["bandwidth", "user", range],
    queryFn: () => userBandwidth(range),
    staleTime: 60_000,
  })

  const buckets = bwQ.data?.buckets ?? []
  const totalRx = buckets.reduce((s, b) => s + b.rx_bytes, 0)
  const totalTx = buckets.reduce((s, b) => s + b.tx_bytes, 0)
  const peakRx = buckets.reduce((m, b) => Math.max(m, b.rx_bytes), 0)
  const peakTx = buckets.reduce((m, b) => Math.max(m, b.tx_bytes), 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Workspace · 03"
        title="Bandwidth"
        sub="Aggregated samples · 1m → 5m → 1h roll-ups"
        right={
          <Seg
            value={range}
            options={["24h", "7d", "30d"] as const}
            onChange={(v) => setRange(v)}
          />
        }
      />

      <KpiStrip>
        <Kpi
          label={`RX · total · ${range}`}
          value={formatBytes(totalRx)}
          spark={buckets.slice(-32).map((b) => b.rx_bytes)}
          sparkColor="var(--chart-1)"
          footL="received"
        />
        <Kpi
          label={`TX · total · ${range}`}
          value={formatBytes(totalTx)}
          spark={buckets.slice(-32).map((b) => b.tx_bytes)}
          sparkColor="var(--primary)"
          footL="sent"
        />
        <Kpi
          label="RX peak"
          value={formatBytes(peakRx)}
          footL="single bucket"
        />
        <Kpi
          label="TX peak"
          value={formatBytes(peakTx)}
          footL="single bucket"
        />
      </KpiStrip>

      <Panel
        title={`Throughput · ${range}`}
        sub={`${buckets.length} samples`}
      >
        {bwQ.isLoading ? (
          <Skeleton className="h-64 rounded-none" />
        ) : (
          <BandwidthChart buckets={buckets} height={320} />
        )}
      </Panel>
    </div>
  )
}

