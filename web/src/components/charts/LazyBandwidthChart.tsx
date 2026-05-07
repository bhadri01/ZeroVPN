import { lazy, Suspense } from "react"

import type { BandwidthBucket } from "@/lib/api"

const Real = lazy(() =>
  import("./BandwidthChart").then((m) => ({ default: m.BandwidthChart })),
)

interface Props {
  buckets: BandwidthBucket[]
  height?: number
}

/**
 * Lazy wrapper around the real BandwidthChart. Recharts pulls in d3-* +
 * react-smooth which is ~250 KB; loading it on demand keeps the entry
 * bundle smaller.
 */
export function BandwidthChart(props: Props) {
  return (
    <Suspense
      fallback={
        <div
          className="text-muted-foreground flex items-center justify-center rounded-lg border text-sm"
          style={{ height: props.height ?? 220 }}
        >
          Loading chart…
        </div>
      }
    >
      <Real {...props} />
    </Suspense>
  )
}
