import {
  IconBrandAndroid,
  IconBrandApple,
  IconBrandUbuntu,
  IconBrandWindows,
  IconDeviceDesktop,
  IconDeviceLaptop,
  IconDeviceMobile,
  IconDevices,
  IconFocusCentered,
  IconMinus,
  IconPlus,
  IconServer,
  type Icon,
  type IconProps,
} from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { DeviceOs, DeviceStatus, PublicDevice } from "@/lib/api"

interface LiveTopologyProps {
  devices: PublicDevice[]
  rates: Map<string, { rxBps: number; txBps: number }>
  /** Label shown next to the central hub. Defaults to "vpn-server". */
  serverLabel?: string
  /** Optional hub meta line (e.g. CIDR). */
  serverMeta?: string
}

const W = 1000
const H = 560
const HUB_X = W / 2
const HUB_Y = H / 2
const RING_INNER = 170
const RING_OUTER = 245
const SINGLE_RING = 200
const MAX_PEERS = 24

function iconFor(os: DeviceOs): Icon {
  switch (os) {
    case "ios":
    case "android":
      return os === "ios" ? IconBrandApple : IconBrandAndroid
    case "macos":
      return IconBrandApple
    case "windows":
      return IconBrandWindows
    case "linux":
      return IconBrandUbuntu
    case "other":
    default:
      return IconDevices
  }
}

/** Picks a generic form-factor icon for the OS — used as the centered glyph
 *  inside the peer ring (the brand mark sits beside it as a chip). */
function shapeFor(os: DeviceOs): Icon {
  switch (os) {
    case "ios":
    case "android":
      return IconDeviceMobile
    case "macos":
      return IconDeviceLaptop
    case "windows":
      return IconDeviceDesktop
    case "linux":
      return IconServer
    default:
      return IconDevices
  }
}

function toneFor(status: DeviceStatus, hasTraffic: boolean) {
  if (status === "revoked") return "revoked"
  if (status === "paused") return "paused"
  return hasTraffic ? "live" : "idle"
}

/** Stable angle derived from device id — keeps positions consistent across
 *  re-renders even when devices come and go. */
function angleFor(id: string, total: number, index: number): number {
  // Even spread but offset by a hash so similar device IDs don't cluster.
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const jitter = ((h & 0xffff) / 0xffff) * 0.5 // 0–0.5 of a slot
  return ((index + jitter) / total) * Math.PI * 2 - Math.PI / 2
}

interface LaidOutPeer {
  device: PublicDevice
  x: number
  y: number
  tone: "live" | "idle" | "paused" | "revoked"
  rateBps: number
}

const MIN_SCALE = 0.4
const MAX_SCALE = 3.5

interface View {
  tx: number
  ty: number
  scale: number
}

const INITIAL_VIEW: View = { tx: 0, ty: 0, scale: 1 }

export function LiveTopology({
  devices,
  rates,
  serverLabel = "vpn-server",
  serverMeta,
}: LiveTopologyProps) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 2), 1200)
    return () => clearInterval(id)
  }, [])

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const dragRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Convert client (pixel) coordinates to viewBox (SVG user) coordinates,
  // so panning/zooming math stays in the same space as our laid-out nodes
  // regardless of the rendered element size.
  const clientToView = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: clientX, y: clientY }
    const rect = svg.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * W
    const y = ((clientY - rect.top) / rect.height) * H
    return { x, y }
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Ignore right/middle clicks so we don't fight context menus.
      if (e.button !== 0) return
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      const p = clientToView(e.clientX, e.clientY)
      dragRef.current = { startX: p.x, startY: p.y, tx: view.tx, ty: view.ty }
      setIsDragging(true)
    },
    [clientToView, view.tx, view.ty],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const d = dragRef.current
      if (!d) return
      const p = clientToView(e.clientX, e.clientY)
      setView((v) => ({
        ...v,
        tx: d.tx + (p.x - d.startX),
        ty: d.ty + (p.y - d.startY),
      }))
    },
    [clientToView],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
    setIsDragging(false)
  }, [])

  // Wheel zoom — keep the point under the cursor anchored. Capture native
  // wheel via a non-passive listener so we can preventDefault and avoid
  // the page scrolling while zooming the graph.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const cx = ((e.clientX - rect.left) / rect.width) * W
      const cy = ((e.clientY - rect.top) / rect.height) * H
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015)
        const nextScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
        // Anchor: keep the point (cx, cy) in viewBox space fixed under the
        // cursor by adjusting tx/ty after the scale change.
        const k = nextScale / v.scale
        const tx = cx - (cx - v.tx) * k
        const ty = cy - (cy - v.ty) * k
        return { tx, ty, scale: nextScale }
      })
    }
    svg.addEventListener("wheel", onWheel, { passive: false })
    return () => svg.removeEventListener("wheel", onWheel)
  }, [])

  const zoom = (factor: number) => {
    setView((v) => {
      const nextScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
      // Zoom around the SVG center to keep the action predictable when the
      // user hits the +/- buttons.
      const cx = W / 2
      const cy = H / 2
      const k = nextScale / v.scale
      return {
        tx: cx - (cx - v.tx) * k,
        ty: cy - (cy - v.ty) * k,
        scale: nextScale,
      }
    })
  }

  const resetView = () => setView(INITIAL_VIEW)

  const visible = useMemo(() => {
    const live = devices.filter((d) => d.status !== "revoked")
    return live.slice(0, MAX_PEERS)
  }, [devices])

  const hidden = Math.max(0, devices.filter((d) => d.status !== "revoked").length - visible.length)

  const placed: LaidOutPeer[] = useMemo(() => {
    const n = visible.length
    if (n === 0) return []
    // One ring for up to 8, two rings beyond.
    const useTwoRings = n > 8
    return visible.map((d, i) => {
      const rate = rates.get(d.id)
      const rateBps = (rate?.rxBps ?? 0) + (rate?.txBps ?? 0)
      const hasTraffic = rateBps > 1024
      const tone = toneFor(d.status, hasTraffic)
      const onInner = useTwoRings && i % 2 === 0
      const r = useTwoRings ? (onInner ? RING_INNER : RING_OUTER) : SINGLE_RING
      const a = angleFor(d.id, n, i)
      const x = HUB_X + Math.cos(a) * r
      const y = HUB_Y + Math.sin(a) * r * 0.62 // squash vertically so labels fit
      return { device: d, x, y, tone, rateBps }
    })
  }, [visible, rates])

  // Inverse-scale glyph stroke widths so icons + lines don't get heavy when
  // zoomed out and don't get hair-thin when zoomed in. Capped so things stay
  // readable at extreme scales.
  const strokeScale = clamp(1 / view.scale, 0.5, 2)

  return (
    <div className="zv-livetopo-wrap relative h-full w-full">
      <svg
        ref={svgRef}
        className={`zv-topo zv-livetopo ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        style={{ touchAction: "none" }}
      >
        <defs>
          <pattern
            id="zv-livetopo-grid"
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
        {/* grid is drawn full-bleed; its pattern transform keeps it locked
            to the scene under pan/zoom */}
        <rect
          width={W}
          height={H}
          fill="url(#zv-livetopo-grid)"
          opacity="0.55"
          className="text-border"
        />

        <g
          transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          style={{ vectorEffect: "non-scaling-stroke" }}
        >
          {/* edges + flow */}
          {placed.map((p) => {
            const isLive = p.tone === "live"
            return (
              <g key={`e-${p.device.id}`}>
                <line
                  x1={HUB_X}
                  y1={HUB_Y}
                  x2={p.x}
                  y2={p.y}
                  className={isLive ? "zv-topo-edge-live" : "zv-topo-edge"}
                  strokeWidth={0.8 * strokeScale}
                />
                {isLive && (
                  <line
                    className="zv-topo-flow"
                    x1={HUB_X}
                    y1={HUB_Y}
                    x2={p.x}
                    y2={p.y}
                    strokeWidth={1.2 * strokeScale}
                    strokeDasharray="2 5"
                    style={{
                      animationDuration:
                        Math.max(0.8, 2.5 - Math.log10(Math.max(1, p.rateBps) / 100) * 0.3) +
                        "s",
                    }}
                  />
                )}
              </g>
            )
          })}

          {/* peers */}
          {placed.map((p) => (
            <PeerNode key={p.device.id} peer={p} />
          ))}

          {/* hub on top, last so it overlaps incoming edges */}
          <HubNode
            tick={tick}
            label={serverLabel}
            meta={serverMeta}
            peerCount={placed.length}
            hidden={hidden}
          />
        </g>

        {/* HUD — sits in screen-space (outside the transformed group) so
            metrics stay anchored to the corner under any zoom level */}
        <g transform={`translate(${W - 200}, 20)`} className="zv-topo-meta">
          <text fontSize="9">
            PEERS · {placed.filter((p) => p.tone === "live").length}/
            {devices.filter((d) => d.status !== "revoked").length}
          </text>
          <text fontSize="9" y={12}>
            HUBS · 1
          </text>
          <text fontSize="9" y={24}>
            ZOOM · {view.scale.toFixed(2)}×
          </text>
        </g>
      </svg>

      {/* Pan/zoom controls — keep them small + tucked in the bottom-right
          so the canvas stays uncluttered. */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Zoom in"
          className="zv-icon-btn bg-card"
          onClick={() => zoom(1.25)}
          disabled={view.scale >= MAX_SCALE}
        >
          <IconPlus size={14} />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          className="zv-icon-btn bg-card"
          onClick={() => zoom(0.8)}
          disabled={view.scale <= MIN_SCALE}
        >
          <IconMinus size={14} />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          className="zv-icon-btn bg-card"
          onClick={resetView}
          disabled={view.tx === 0 && view.ty === 0 && view.scale === 1}
        >
          <IconFocusCentered size={14} />
        </button>
      </div>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

function HubNode({
  tick,
  label,
  meta,
  peerCount,
  hidden,
}: {
  tick: number
  label: string
  meta?: string
  peerCount: number
  hidden: number
}) {
  return (
    <g transform={`translate(${HUB_X}, ${HUB_Y})`}>
      <circle r={28 + tick} className="zv-topo-halo" opacity="0.55" />
      <circle r={22} className="zv-topo-halo" opacity="0.85" />
      <circle r={18} className="zv-topo-hub" strokeWidth="1.4" />
      {/* server glyph */}
      <g transform="translate(-10, -10)" className="zv-topo-hub-icon">
        <IconServer size={20} strokeWidth={1.6} />
      </g>
      {/* label chip */}
      <g transform="translate(24, -10)">
        <rect width={90} height={20} className="zv-topo-hub-tag" strokeWidth="0.5" rx={1} />
        <text x={6} y={13} className="zv-topo-hub-label">
          {label}
        </text>
      </g>
      <text x={24} y={28} className="zv-topo-meta zv-topo-meta-ink">
        {peerCount} peers
        {hidden > 0 ? ` (+${hidden})` : ""}
      </text>
      {meta && (
        <text x={24} y={40} className="zv-topo-meta">
          {meta}
        </text>
      )}
    </g>
  )
}

function PeerNode({ peer }: { peer: LaidOutPeer }) {
  const Shape = shapeFor(peer.device.os)
  const Brand = iconFor(peer.device.os)
  const strokeClass =
    peer.tone === "live"
      ? "zv-topo-peer-live"
      : peer.tone === "paused"
        ? "zv-topo-peer-paused"
        : "zv-topo-peer-idle"
  const labelAnchor: "start" | "end" = peer.x >= HUB_X ? "start" : "end"
  const labelDx = labelAnchor === "start" ? 18 : -18
  return (
    <g transform={`translate(${peer.x}, ${peer.y})`} className="zv-topo-peer">
      {/* outer ring */}
      <circle r={14} className={strokeClass} strokeWidth="1.2" />
      {/* OS-shape glyph at center */}
      <g transform="translate(-9, -9)" className="zv-topo-peer-icon">
        <Shape size={18} strokeWidth={1.5} />
      </g>
      {/* tiny brand chip on the bottom-right of the node */}
      <g transform="translate(8, 6)" className="zv-topo-peer-brand">
        <circle r={6} className="zv-topo-peer-brand-bg" />
        <g transform="translate(-4, -4)">
          <Brand size={8} strokeWidth={1.8} />
        </g>
      </g>
      {/* label */}
      <text
        x={labelDx}
        y={4}
        textAnchor={labelAnchor}
        className="zv-topo-peer-label"
      >
        {peer.device.name}
      </text>
      {peer.tone === "live" && peer.rateBps > 1024 && (
        <text
          x={labelDx}
          y={18}
          textAnchor={labelAnchor}
          className="zv-topo-meta"
        >
          {formatRateShort(peer.rateBps)}
        </text>
      )}
    </g>
  )
}

function formatRateShort(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(0)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
}

// `IconProps` is referenced indirectly through type-only imports so the
// bundler doesn't ship the type at runtime; keep the import to satisfy
// downstream consumers that may extend this component.
export type { IconProps }
