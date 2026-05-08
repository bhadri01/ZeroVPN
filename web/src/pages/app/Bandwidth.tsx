import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { BandwidthChart } from "@/components/charts/LazyBandwidthChart"
import { PageHeader } from "@/components/PageHeader"
import { Stat } from "@/components/Stat"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type BandwidthRange, userBandwidth } from "@/lib/api"

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
    <div className="space-y-6">
      <PageHeader
        title="Bandwidth"
        description="Aggregate RX/TX across all your devices."
        actions={
          <Tabs
            value={range}
            onValueChange={(v) => setRange(v as BandwidthRange)}
          >
            <TabsList className="h-8">
              <TabsTrigger value="24h">24h</TabsTrigger>
              <TabsTrigger value="7d">7d</TabsTrigger>
              <TabsTrigger value="30d">30d</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="RX total"
          value={totalRx}
          format={formatBytes}
          hint="received"
        />
        <Stat
          label="TX total"
          value={totalTx}
          format={formatBytes}
          hint="sent"
        />
        <Stat
          label="RX peak"
          value={peakRx}
          format={formatBytes}
          hint="single bucket"
        />
        <Stat
          label="TX peak"
          value={peakTx}
          format={formatBytes}
          hint="single bucket"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Throughput</CardTitle>
          <CardDescription>
            RX and TX over the selected window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bwQ.isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <BandwidthChart buckets={buckets} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes < 1024 ** 4) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`
}
