import { lazy, Suspense } from "react"

import { Skeleton } from "@/components/ui/skeleton"

const NetworkMonitorChartImpl = lazy(() =>
  import("@/components/charts/NetworkMonitorChart").then((m) => ({
    default: m.NetworkMonitorChart,
  })),
)
const LiveIndicatorImpl = lazy(() =>
  import("@/components/charts/NetworkMonitorChart").then((m) => ({
    default: m.LiveIndicator,
  })),
)

type ChartProps = React.ComponentProps<typeof NetworkMonitorChartImpl>

export function NetworkMonitorChart(props: ChartProps) {
  const height = props.height ?? 220
  return (
    <Suspense fallback={<Skeleton style={{ height }} />}>
      <NetworkMonitorChartImpl {...props} />
    </Suspense>
  )
}

export function LiveIndicator() {
  return (
    <Suspense fallback={null}>
      <LiveIndicatorImpl />
    </Suspense>
  )
}
