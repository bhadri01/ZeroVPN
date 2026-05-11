import { useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"

import type { PublicDevice } from "@/lib/api"

/** Returns a key that changes whenever the html element's class list does.
 * Cheap MutationObserver — only fires on theme flips, not every paint. */
function useThemeKey(): string {
  const [k, setK] = useState(() =>
    typeof document === "undefined" ? "" : document.documentElement.className,
  )
  useEffect(() => {
    if (typeof document === "undefined") return
    const obs = new MutationObserver(() => {
      setK(document.documentElement.className)
    })
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => obs.disconnect()
  }, [])
  return k
}

interface NodeDatum {
  id: string
  label: string
  kind: "server" | "device"
  status: "active" | "paused" | "revoked"
  x?: number
  y?: number
}

interface LinkDatum {
  source: string
  target: string
  /** Smoothed RX/TX rate in bps (sum). Drives particle count and speed. */
  rateBps: number
  /** Direction of net traffic flow at this instant. */
  direction: "tx" | "rx" | "idle"
}

interface Props {
  devices: PublicDevice[]
  /** Per-device live stats. Update on every WS frame. */
  rates: Map<string, { rxBps: number; txBps: number }>
  height?: number
}

const SERVER_NODE_ID = "__server__"

/** Read the resolved CSS variable from <html>. Cached lazily so we don't
 * hit the DOM for every paint. Re-resolved if the theme class flips. */
function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return v || fallback
}

function paletteFor(themeKey: string) {
  void themeKey // referenced so the memo recomputes on theme switch
  return {
    serverNode: readVar("--chart-1", "#1e5fcc"),
    active: readVar("--status-online", "#1f8a3f"),
    paused: readVar("--status-degraded", "#b86a00"),
    revoked: readVar("--destructive", "#c5283d"),
    idle: readVar("--muted-foreground", "#6b6b66"),
    tx: readVar("--primary", "#c6ff3d"),
    rx: readVar("--chart-1", "#1e5fcc"),
  } as const
}

export function TopologyGraph({ devices, rates, height = 360 }: Props) {
  // The library's exported types don't quite match the runtime methods we
  // need; an `any` ref is the pragmatic escape hatch (we only call public
  // imperative methods like `d3ReheatSimulation`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Re-read CSS vars when the document's theme class changes so colors
  // track light/dark toggles without forcing a remount of the graph.
  const themeKey = useThemeKey()
  const COLORS = useMemo(() => paletteFor(themeKey), [themeKey])

  const data = useMemo(() => {
    const nodes: NodeDatum[] = [
      {
        id: SERVER_NODE_ID,
        label: "server",
        kind: "server",
        status: "active",
      },
    ]
    const links: LinkDatum[] = []
    for (const d of devices) {
      if (d.status === "revoked") continue
      nodes.push({
        id: d.id,
        label: d.name,
        kind: "device",
        status: d.status,
      })
      const live = rates.get(d.id) ?? { rxBps: 0, txBps: 0 }
      const rateBps = live.rxBps + live.txBps
      const direction: LinkDatum["direction"] =
        rateBps < 100 ? "idle" : live.txBps > live.rxBps ? "tx" : "rx"
      links.push({ source: SERVER_NODE_ID, target: d.id, rateBps, direction })
    }
    return { nodes, links }
  }, [devices, rates])

  // Apply smoothed rate to particle props imperatively whenever rates change.
  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return
    // Force the simulation to "see" updated link props by triggering refresh.
    fg.d3ReheatSimulation()
  }, [rates])

  return (
    <div
      ref={containerRef}
      className="bg-card border-border overflow-hidden border"
      style={{ height }}
    >
      <ForceGraph2D
        ref={graphRef}
        graphData={data}
        height={height}
        width={containerRef.current?.clientWidth ?? 600}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={120}
        nodeRelSize={6}
        nodeLabel={(n) => n.label}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const r = node.kind === "server" ? 12 : 7
          ctx.beginPath()
          ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI)
          ctx.fillStyle =
            node.kind === "server"
              ? COLORS.serverNode
              : node.status === "active"
                ? COLORS.active
                : node.status === "paused"
                  ? COLORS.paused
                  : COLORS.revoked
          ctx.fill()
          // Label
          const fontSize = 11 / globalScale
          ctx.font = `${fontSize}px "Geist Mono Variable", ui-monospace, monospace`
          ctx.fillStyle = COLORS.idle
          ctx.textAlign = "center"
          ctx.textBaseline = "top"
          ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + r + 2)
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(node.x ?? 0, node.y ?? 0, node.kind === "server" ? 14 : 9, 0, 2 * Math.PI)
          ctx.fill()
        }}
        linkColor={(l) =>
          l.direction === "tx" ? COLORS.tx : l.direction === "rx" ? COLORS.rx : COLORS.idle
        }
        linkWidth={(l) => 1 + Math.min(3, Math.log10(Math.max(1, l.rateBps / 1000)))}
        linkDirectionalParticles={(l) => {
          if (l.rateBps < 100) return 0
          // 1–8 particles based on log of rate.
          return Math.min(8, Math.max(1, Math.floor(Math.log10(l.rateBps / 100))))
        }}
        linkDirectionalParticleSpeed={(l) =>
          // 0.001 (slow) to 0.012 (fast). Above 0.012 looks unsettled.
          Math.min(0.012, Math.max(0.001, l.rateBps / 5_000_000))
        }
        linkDirectionalParticleColor={(l) =>
          l.direction === "tx" ? COLORS.tx : l.direction === "rx" ? COLORS.rx : COLORS.idle
        }
        linkDirectionalParticleWidth={2}
      />
    </div>
  )
}

/**
 * Apply an EMA smoothing pass to the live rates. Keeps the visualisation
 * calm — instantaneous WS frames flicker too much for the eye.
 */
export function applyEmaSmoothing(
  prev: Map<string, { rxBps: number; txBps: number }>,
  next: { deviceId: string; rxBps: number; txBps: number },
  alpha = 0.4,
): Map<string, { rxBps: number; txBps: number }> {
  const updated = new Map(prev)
  const old = updated.get(next.deviceId) ?? { rxBps: 0, txBps: 0 }
  updated.set(next.deviceId, {
    rxBps: alpha * next.rxBps + (1 - alpha) * old.rxBps,
    txBps: alpha * next.txBps + (1 - alpha) * old.txBps,
  })
  return updated
}
