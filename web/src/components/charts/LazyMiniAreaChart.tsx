import { lazy, Suspense } from "react"

import { Skeleton } from "@/components/ui/skeleton"

const MiniAreaChartImpl = lazy(() =>
  import("@/components/charts/MiniAreaChart").then((m) => ({
    default: m.MiniAreaChart,
  })),
)

type Props = React.ComponentProps<typeof MiniAreaChartImpl>

export function MiniAreaChart(props: Props) {
  const height = props.height ?? 60
  return (
    <Suspense fallback={<Skeleton style={{ height }} />}>
      <MiniAreaChartImpl {...props} />
    </Suspense>
  )
}
