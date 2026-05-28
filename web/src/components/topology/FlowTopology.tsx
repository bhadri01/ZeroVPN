import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconServer,
  IconWorld,
  type Icon,
} from "@tabler/icons-react"
import { motion } from "motion/react"
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react"

import { WithTooltip } from "@/components/ui/with-tooltip"
import type { Flow } from "@/lib/api"

/**
 * Active-flow topology view — the "Connections" mode of the topology
 * canvas.
 *
 * Ported from the legacy VPN project's `ConnectionTopology` and adapted
 * to the rest of the app's design system. Renders one VPN-hub node in
 * the center, every observed source peer on an inner ring around it,
 * and each peer's distinct targets on a small sub-ring around the peer.
 * Curved (currently linear) SVG edges connect the tiers with an animated
 * `<animateMotion>` packet so the user can see traffic moving.
 *
 * The canvas supports:
 *   - drag-to-pan the whole view (pointer-down on empty space)
 *   - scroll-to-zoom (clamped, container-anchored)
 *   - drag individual nodes to rearrange (stable positions preserved
 *     across re-renders so reordering doesn't snap back when the parent
 *     refetches the flow list every few seconds)
 *
 * Stale node positions are GC'd when a node disappears from a fresh
 * `flows` prop, so a peer going idle for a polling cycle is hidden and
 * comes back if it returns.
 */

interface FlowTopologyProps {
  flows: Flow[]
  /** Human label for the hub node. Defaults to "vpn-server". */
  serverLabel?: string
  /** Polling-state hint (used to render the count badge tone). */
  loading?: boolean
  /** When true, only render flows whose **source** is a known VPN peer
   *  — i.e. drop foreign-source flows (peer-as-target connections from
   *  the outside). Pairs with the Devices view's same-named toggle so
   *  both modes obey one global "live only" intent: in the Flows world
   *  every conntrack entry is by definition currently established, so
   *  the stricter useful filter is "show only flows my peers initiated". */
  liveOnly?: boolean
}

interface FlowNode {
  id: string
  /** What sort of glyph to render. */
  kind: "hub" | "peer" | "target"
  label: string
  subLabel?: string
  /** Initial canvas-space position; persisted node positions track this
   *  on first appearance and then float independently if the user drags. */
  x: number
  y: number
  /** Optional details surfaced by the hover tooltip. */
  meta?: {
    protocol?: string
    ports?: string
    isExternal?: boolean
  }
}

interface FlowEdge {
  sourceId: string
  targetId: string
}

/** Lookup an icon ref for a flow node. Returns a stable `@tabler` Icon
 *  component — the call site renders it through `React.createElement`
 *  so the react-hooks/static-components lint doesn't flag this as a
 *  component-created-during-render. */
function iconForNode(kind: FlowNode["kind"], label: string): Icon {
  if (kind === "hub") return IconServer
  if (kind === "target") {
    // Domain-named targets get the world icon; raw IPs stay as a generic
    // host icon so the difference between "talks to cloudflare.com" and
    // "talks to 1.2.3.4" is visible at a glance.
    if (label === "External") return IconWorld
    return IconDeviceDesktop
  }
  // Peer: mobile-ish names get the phone glyph; everything else laptop.
  const lower = label.toLowerCase()
  if (
    lower.includes("phone") ||
    lower.includes("mobile") ||
    lower.includes("android") ||
    lower.includes("ios")
  ) {
    return IconDeviceMobile
  }
  return IconDeviceDesktop
}

/**
 * Layout — nested full circles, same idiom as LiveTopology:
 *   - hub (vpn-server) in the center
 *   - source peers on a full circle around the hub
 *   - each peer's distinct **targets** on a full circle around that peer
 *
 * All three radii are computed from the actual node counts so adjacent
 * peers never collide and no peer's target circle eats the hub. See
 * `peerRingFor` / `outerRingFor` for the derivation — chord on a circle
 * of radius `r` with N nodes is `2r·sin(π/N)`, so `r >= halo / sin(π/N)`
 * keeps neighbors clear.
 */
const FLOW_HUB_HALO = 36
const FLOW_PEER_HALO = 22 // matches `size-10` glyph + a touch of label slack
const FLOW_RING_GAP = 18
const FLOW_HALO = FLOW_PEER_HALO + FLOW_RING_GAP / 2

const MIN_PEER_RING = 140
const MIN_TARGET_RING = 70
const MAX_PEER_RING = 820
const MAX_TARGET_RING = 200

/** Per-peer target-ring radius — fit `k` targets on a full circle. */
function targetRingFor(k: number): number {
  if (k <= 1) return MIN_TARGET_RING
  const r = FLOW_HALO / Math.max(Math.sin(Math.PI / k), 0.05)
  return Math.min(Math.max(MIN_TARGET_RING, r), MAX_TARGET_RING)
}

/** Outer (peer) ring radius — large enough that adjacent peers' target
 *  circles (each `maxTargetRing` wide) don't overlap AND each target
 *  circle's inner edge clears the hub. */
function peerRingFor(peerCount: number, maxTargetRing: number): number {
  const halfWidth = maxTargetRing + FLOW_HALO
  const hubClear = maxTargetRing + FLOW_HUB_HALO + FLOW_RING_GAP
  if (peerCount <= 1) return Math.max(MIN_PEER_RING, hubClear)
  const ang = Math.sin(Math.PI / peerCount)
  return Math.min(
    Math.max(MIN_PEER_RING, halfWidth / Math.max(ang, 0.05), hubClear),
    MAX_PEER_RING,
  )
}

function buildLayout(
  flows: Flow[],
  centerX: number,
  centerY: number,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  // Group flows by source peer (by IP — same IP from many ports collapses
  // into one source node). Each group's targets are the unique
  // (dst_ip, dst_port, protocol) tuples it reached.
  const groups = new Map<
    string,
    {
      source: Flow["source"]
      targets: Array<{
        target: Flow["target"]
        source_port?: number
        target_port?: number
        protocol: string
      }>
      seen: Set<string>
    }
  >()
  for (const f of flows) {
    const key = f.source.ip
    if (!groups.has(key)) {
      groups.set(key, { source: f.source, targets: [], seen: new Set() })
    }
    const g = groups.get(key)!
    const tk = `${f.protocol}:${f.target.ip}:${f.target_port ?? ""}`
    if (g.seen.has(tk)) continue
    g.seen.add(tk)
    g.targets.push({
      target: f.target,
      source_port: f.source_port,
      target_port: f.target_port,
      protocol: f.protocol,
    })
  }

  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  const HUB_ID = "hub"
  nodes.push({
    id: HUB_ID,
    kind: "hub",
    label: "vpn-server",
    x: centerX,
    y: centerY,
  })

  // Compute target-ring radii per source AND the worst across all sources;
  // the peer-ring radius scales to fit the worst case.
  const groupList = Array.from(groups.values())
  const targetRings = groupList.map((g) => targetRingFor(g.targets.length))
  const maxTargetRing = targetRings.reduce((m, r) => Math.max(m, r), MIN_TARGET_RING)
  const PEER_RING = peerRingFor(groupList.length, maxTargetRing)

  groupList.forEach((g, gi) => {
    // Source peers sit on a full circle around the hub, evenly spaced.
    const angle =
      groupList.length === 1
        ? -Math.PI / 2
        : ((gi + 0.5) / groupList.length) * Math.PI * 2 - Math.PI / 2
    const px = centerX + PEER_RING * Math.cos(angle)
    const py = centerY + PEER_RING * Math.sin(angle)
    const peerId = `peer:${g.source.ip}`
    nodes.push({
      id: peerId,
      kind: "peer",
      label: g.source.name,
      subLabel: g.source.ip,
      x: px,
      y: py,
    })
    edges.push({ sourceId: HUB_ID, targetId: peerId })

    // Each peer's targets sit on a full circle around the peer, with the
    // first target anchored on the outward radial so the user→first edge
    // lines up with the hub→user one. Same nested-rings shape the device
    // topology uses.
    const targetRing = targetRings[gi]
    const k = g.targets.length
    g.targets.forEach((t, ti) => {
      const tAngle = k <= 1 ? angle : angle + (ti / k) * Math.PI * 2
      const tx = px + targetRing * Math.cos(tAngle)
      const ty = py + targetRing * Math.sin(tAngle)
      const targetId = `t:${t.protocol}:${g.source.ip}:${t.source_port ?? ""}->${t.target.ip}:${t.target_port ?? ""}`
      nodes.push({
        id: targetId,
        kind: "target",
        label: t.target.name,
        subLabel: t.target.ip,
        x: tx,
        y: ty,
        meta: {
          protocol: t.protocol,
          ports:
            t.source_port != null && t.target_port != null
              ? `${t.source_port} → ${t.target_port}`
              : undefined,
          isExternal: t.target.name === "External",
        },
      })
      edges.push({ sourceId: peerId, targetId })
    })
  })

  return { nodes, edges }
}

interface DragState {
  id: string
  startX: number
  startY: number
  initialX: number
  initialY: number
}

interface PanState {
  startX: number
  startY: number
  initialTx: number
  initialTy: number
}

const MIN_ZOOM = 0.3
const MAX_ZOOM = 3
const ZOOM_INTENSITY = 0.001

export function FlowTopology({
  flows,
  serverLabel = "vpn-server",
  loading = false,
  liveOnly = false,
}: FlowTopologyProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState({ width: 800, height: 600 })

  // `liveOnly` filter — drop flows where the source isn't a known VPN
  // peer. In Flows mode that maps to "only show traffic my peers
  // initiated", which is the corresponding "live in the VPN right now"
  // signal (Devices view filters by recent WG handshake; Flows by
  // ESTABLISHED-conntrack-from-peer-source).
  const filteredFlows = useMemo(
    () =>
      liveOnly ? flows.filter((f) => f.source.device_id != null) : flows,
    [flows, liveOnly],
  )

  // Watch container size so the initial node layout matches the actual
  // canvas (instead of a hardcoded 800x600 frame that ends up off-screen
  // on a wide monitor).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect
        if (width > 0 && height > 0) setDims({ width, height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Computed layout from the current flows + container size. Positions
  // for nodes that already exist in `nodePositions` (i.e. the user
  // dragged them) are preserved on the next render; new nodes adopt
  // their layout-computed position; vanished nodes are GC'd.
  const layout = useMemo(
    () => buildLayout(filteredFlows, dims.width / 2, dims.height / 2),
    [filteredFlows, dims.width, dims.height],
  )

  // User-drag overrides: only nodes the user has explicitly moved live
  // in this map. `nodePositions` is derived from `layout + overrides` so
  // a fresh poll updates auto-placed nodes immediately while dragged
  // nodes stay where the user put them. Vanished nodes naturally drop
  // out because `layout.nodes` no longer references them; we trim the
  // override map below in the same render to keep it from growing
  // unbounded across many polling cycles.
  const [overrides, setOverrides] = useState<
    Record<string, { x: number; y: number }>
  >({})
  const nodePositions = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {}
    for (const n of layout.nodes) {
      out[n.id] = overrides[n.id] ?? { x: n.x, y: n.y }
    }
    return out
  }, [layout, overrides])
  // Stale overrides for nodes that vanish from the layout naturally drop
  // out of the rendered output (the `useMemo` above only includes ids
  // present in `layout.nodes`), so we don't bother GC'ing the map — the
  // set is bounded by however many nodes a user actually dragged in a
  // session, which is tiny.

  // Content envelope — half the diameter the laid-out graph occupies,
  // measured from the canvas center. Used to compute an auto-fit zoom
  // that keeps every node on screen on first paint even when the ring
  // radii grow past the container.
  const contentRadius = useMemo(() => {
    if (layout.nodes.length === 0) return 0
    const cx = dims.width / 2
    const cy = dims.height / 2
    let max = 0
    for (const n of layout.nodes) {
      const dx = n.x - cx
      const dy = n.y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > max) max = d
    }
    return max + FLOW_PEER_HALO + 60 // halo + label padding
  }, [layout, dims.width, dims.height])

  // Auto-fit scale: shrink the view if the content radius is bigger than
  // half the container's short axis. Clamped to MIN_ZOOM so we never
  // squash beyond legibility (operator pans instead).
  const autoFitScale = useMemo(() => {
    if (contentRadius <= 0) return 1
    const half = Math.min(dims.width, dims.height) / 2
    if (contentRadius <= half) return 1
    return Math.max(MIN_ZOOM, half / contentRadius)
  }, [contentRadius, dims.width, dims.height])

  // View transform — pan via background drag, zoom via wheel. We seed
  // it from `autoFitScale` so wide graphs render fully on first paint,
  // but a `userTouchedRef` flag suppresses re-fitting once the user
  // pans/zooms manually (so refetches don't snap the view back).
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 })
  const userTouchedRef = useRef(false)
  useEffect(() => {
    if (userTouchedRef.current) return
    setView((v) =>
      Math.abs(v.scale - autoFitScale) > 0.001 ? { ...v, scale: autoFitScale } : v,
    )
  }, [autoFitScale])
  const [pan, setPan] = useState<PanState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const onBackgroundPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    userTouchedRef.current = true
    setPan({
      startX: e.clientX,
      startY: e.clientY,
      initialTx: view.tx,
      initialTy: view.ty,
    })
  }
  const onNodePointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    nodeId: string,
  ) => {
    e.stopPropagation()
    const cur = nodePositions[nodeId]
    if (!cur) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setDrag({
      id: nodeId,
      startX: e.clientX,
      startY: e.clientY,
      initialX: cur.x,
      initialY: cur.y,
    })
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag) {
      const dx = (e.clientX - drag.startX) / view.scale
      const dy = (e.clientY - drag.startY) / view.scale
      setOverrides((prev) => ({
        ...prev,
        [drag.id]: { x: drag.initialX + dx, y: drag.initialY + dy },
      }))
      return
    }
    if (pan) {
      setView((v) => ({
        ...v,
        tx: pan.initialTx + (e.clientX - pan.startX),
        ty: pan.initialTy + (e.clientY - pan.startY),
      }))
    }
  }
  const onPointerUp = () => {
    setDrag(null)
    setPan(null)
  }
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    userTouchedRef.current = true
    setView((v) => ({
      ...v,
      scale: Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, v.scale - e.deltaY * ZOOM_INTENSITY),
      ),
    }))
  }

  if (flows.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 font-mono text-xs">
        <IconServer className="text-muted-foreground/50 size-10" />
        <span className="text-muted-foreground">
          {loading ? "Polling conntrack…" : "No active flows right now."}
        </span>
        <span className="text-muted-foreground/60 text-[10px]">
          Flows appear as soon as a peer talks to anything.
        </span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full select-none overflow-hidden ${pan ? "cursor-grabbing" : "cursor-grab"}`}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
    >
      {/* Full-bleed grid backdrop. Same idiom as the Devices view —
          a 40-unit pattern translated/scaled in sync with the pan-zoom
          transform below so the grid "moves with" the graph and anchors
          spatial reference. Sits outside the transform container so
          it always covers the viewport even when the content shifts. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full text-border"
        aria-hidden
      >
        <defs>
          <pattern
            id="zv-flowtopo-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="url(#zv-flowtopo-grid)"
          opacity="0.55"
        />
      </svg>
      <div
        className="absolute inset-0 origin-center"
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        }}
      >
        {/* Edges. Single full-canvas SVG positioned absolutely so the
            same coordinate system as the HTML nodes; `pointer-events:
            none` so drag still targets the underlying background. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          style={{ width: dims.width, height: dims.height }}
        >
          {layout.edges.map((edge, i) => {
            const s = nodePositions[edge.sourceId]
            const t = nodePositions[edge.targetId]
            if (!s || !t) return null
            return <FlowEdgeLine key={`edge-${i}`} sx={s.x} sy={s.y} tx={t.x} ty={t.y} />
          })}
        </svg>

        {layout.nodes.map((n) => {
          const pos = nodePositions[n.id]
          if (!pos) return null
          return (
            <FlowNodeView
              key={n.id}
              node={n}
              x={pos.x}
              y={pos.y}
              serverLabel={serverLabel}
              onPointerDown={(e) => onNodePointerDown(e, n.id)}
            />
          )
        })}
      </div>

      {/* Hint overlay — same idiom as the existing LiveTopology canvas. */}
      <div className="bg-background/70 text-muted-foreground pointer-events-none absolute bottom-2 right-3 rounded px-2 py-1 font-mono text-[10px] backdrop-blur">
        Scroll · zoom &nbsp;·&nbsp; Drag bg · pan &nbsp;·&nbsp; Drag node ·
        rearrange &nbsp;·&nbsp; {Math.round(view.scale * 100)}%
      </div>
    </div>
  )
}

function FlowEdgeLine({
  sx,
  sy,
  tx,
  ty,
}: {
  sx: number
  sy: number
  tx: number
  ty: number
}) {
  const path = `M ${sx} ${sy} L ${tx} ${ty}`
  const dx = tx - sx
  const dy = ty - sy
  // Packet animation duration scaled by distance so the speed feels
  // constant across short and long edges.
  const dist = Math.sqrt(dx * dx + dy * dy)
  const dur = `${Math.max(1, dist / 160).toFixed(2)}s`
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        className="text-border"
        strokeWidth={1.5}
        strokeOpacity={0.55}
      />
      <circle r={3} fill="currentColor" className="text-primary">
        <animateMotion dur={dur} repeatCount="indefinite" path={path} />
      </circle>
    </g>
  )
}

function FlowNodeView({
  node,
  x,
  y,
  serverLabel,
  onPointerDown,
}: {
  node: FlowNode
  x: number
  y: number
  serverLabel: string
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const iconRef = iconForNode(node.kind, node.label)
  const isHub = node.kind === "hub"
  const isExternal = !!node.meta?.isExternal
  const displayLabel = isHub ? serverLabel : node.label

  return (
    <WithTooltip
      side="right"
      label={
        <div className="flex flex-col gap-0.5 font-mono text-[11px]">
          <span className="font-semibold">{displayLabel}</span>
          {node.subLabel && (
            <span className="text-muted-foreground">{node.subLabel}</span>
          )}
          {node.meta?.protocol && (
            <span className="text-muted-foreground uppercase tracking-wider">
              {node.meta.protocol}
              {node.meta.ports ? ` · ${node.meta.ports}` : ""}
            </span>
          )}
        </div>
      }
    >
      <div
        className="absolute flex cursor-grab flex-col items-center active:cursor-grabbing"
        style={{
          left: x,
          top: y,
          transform: "translate(-50%, -50%)",
          zIndex: isHub ? 20 : 10,
        }}
        onPointerDown={onPointerDown}
      >
        <div
          className={[
            // Circle nodes (rounded-full) to match the Devices view glyph
            // treatment — same `bg-background` + colored border, sized so
            // the hub reads as the focal point and peers/targets tier
            // below it. The external-target row is dimmed (muted text +
            // dashed border) so an internet endpoint reads as "out of
            // network" at a glance.
            "bg-background relative flex items-center justify-center rounded-full border-2",
            isHub
              ? "border-primary text-primary size-14 shadow-sm"
              : isExternal
                ? "border-muted-foreground/40 text-muted-foreground size-10 border-dashed"
                : "border-primary/60 text-foreground size-10",
          ].join(" ")}
        >
          {isHub && (
            <motion.div
              className="bg-primary absolute inset-0 -z-10 rounded-full"
              animate={{ opacity: [0.25, 0, 0.25] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          )}
          {createElement(iconRef, {
            className: isHub ? "size-7" : "size-5",
            strokeWidth: 1.5,
          })}
        </div>
        <div className="pointer-events-none mt-1.5 flex max-w-[180px] flex-col items-center gap-0.5">
          <span className="bg-background/80 text-foreground truncate rounded px-1 font-mono text-[10px] font-medium leading-tight backdrop-blur">
            {displayLabel}
          </span>
          {node.subLabel && (
            <span className="text-muted-foreground truncate font-mono text-[9px] leading-tight">
              {node.subLabel}
            </span>
          )}
        </div>
      </div>
    </WithTooltip>
  )
}
