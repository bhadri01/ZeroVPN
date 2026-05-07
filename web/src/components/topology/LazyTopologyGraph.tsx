import { lazy, Suspense } from "react"

import type { PublicDevice } from "@/lib/api"

const Real = lazy(() =>
  import("./TopologyGraph").then((m) => ({ default: m.TopologyGraph })),
)

// EMA helper lives in its own tiny module so importing it doesn't drag the
// heavy d3-force / react-force-graph-2d bundle in eagerly.
export { applyEmaSmoothing } from "./ema"

interface Props {
  devices: PublicDevice[]
  rates: Map<string, { rxBps: number; txBps: number }>
  height?: number
}

/**
 * Lazy wrapper around the topology graph.
 */
export function TopologyGraph(props: Props) {
  return (
    <Suspense
      fallback={
        <div
          className="text-muted-foreground bg-card flex items-center justify-center rounded-lg border text-sm"
          style={{ height: props.height ?? 360 }}
        >
          Loading network graph…
        </div>
      }
    >
      <Real {...props} />
    </Suspense>
  )
}
