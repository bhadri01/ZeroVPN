import {
  IconArrowsMaximize,
  IconArrowsMinimize,
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
  IconUser,
  type Icon,
  type IconProps,
} from "@tabler/icons-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { WithTooltip } from "@/components/ui/with-tooltip"
import { usePageVisible } from "@/hooks/usePageVisible"
import {
  getMyTopology,
  setMyTopology,
  type DeviceOs,
  type DeviceStatus,
  type PublicDevice,
} from "@/lib/api"
import { connState } from "@/lib/deviceState"

interface LiveTopologyProps {
  devices: PublicDevice[]
  rates: Map<string, { rxBps: number; txBps: number }>
  /** Label shown next to the central hub. Defaults to "vpn-server". */
  serverLabel?: string
  /** Optional hub meta line (e.g. CIDR). */
  serverMeta?: string
  /** Optional `user_id -> { label }` map so the user-tier nodes render
   *  with a human name. When a device's user_id isn't found in this
   *  map, the node falls back to "user · <first 6 of uuid>". For the
   *  current user, pass `{ [user.id]: { label: "me" } }` or similar. */
  userMap?: Map<string, { label: string }>
}

// Baseline SVG-unit budget. Both dimensions are computed per-render
// from the container's aspect ratio so the viewBox always matches the
// actual painted area — `preserveAspectRatio` stays at "meet" and we
// get no letterboxing AND no stretching. Floors keep the content area
// large enough that the peer ring doesn't squash on tiny viewports.
const DEFAULT_H = 560
const DEFAULT_VB_W = 1000
// Min content-area envelope. On portrait containers (taller than wide)
// the canvas grows vertically past DEFAULT_H so the SVG fills the full
// container height; on landscape it grows horizontally past
// DEFAULT_VB_W as before.
// 2-level tree geometry. Hub at the center; user-tier nodes orbit on
// USER_RING; each user's devices orbit on a small ring of radius
// PEER_FROM_USER around their user. The vertical squash factor stays
// the same for both rings so labels fit.
const USER_RING = 130
const PEER_FROM_USER = 75
const MAX_PEERS = 24
const MAX_USERS = 12

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

/** Visual tone for a peer node. Connection state (live handshake) is the
 *  source of truth — a device with no recent handshake is `idle`, never
 *  `live`, even if the store happens to hold a stale non-zero rate from
 *  before it dropped. Paused / revoked take precedence over connection
 *  because they're terminal in the lifecycle sense. */
function toneFor(status: DeviceStatus, online: boolean, hasTraffic: boolean) {
  if (status === "revoked") return "revoked"
  if (status === "paused") return "paused"
  if (!online) return "idle"
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
  /** Position of the user this device hangs off (where the edge starts). */
  userX: number
  userY: number
}

interface LaidOutUser {
  userId: string
  label: string
  x: number
  y: number
  /** How many of this user's devices are currently online/transmitting —
   *  drives the user-node tone the same way `connState` drives device tone. */
  liveCount: number
  peerCount: number
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
  userMap,
}: LiveTopologyProps) {
  const [tick, setTick] = useState(0)
  const pageVisible = usePageVisible()
  useEffect(() => {
    // No tick while hidden — the SVG is offscreen, so re-rendering hundreds
    // of nodes every 1.2 s just bloats memory with stale React fibers.
    if (!pageVisible) return
    const id = setInterval(() => setTick((t) => (t + 1) % 2), 1200)
    return () => clearInterval(id)
  }, [pageVisible])

  const svgRef = useRef<SVGSVGElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Dynamic viewBox extent. We compute BOTH dimensions per-render from
  // the container's aspect so `vbW / vbH === containerW / containerH`.
  // With the viewBox matching container aspect, the default
  // `preserveAspectRatio="xMidYMid meet"` neither letterboxes nor
  // stretches — every SVG user-unit maps to the same number of CSS px on
  // both axes, so circles stay circles at every screen size AND the SVG
  // fills the container in both dimensions (which matters on mobile
  // portrait, where keeping H fixed used to leave huge vertical gaps).
  //
  // Strategy: pin whichever dimension is "long" to its DEFAULT, then
  // grow the other dimension to match aspect. That keeps the content
  // (USER_RING, PEER_FROM_USER) at a sensible scale relative to the
  // canvas regardless of container shape.
  const [vbW, setVbW] = useState<number>(DEFAULT_VB_W)
  const [vbH, setVbH] = useState<number>(DEFAULT_H)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      if (r.height <= 0 || r.width <= 0) return
      const containerAspect = r.width / r.height
      const defaultAspect = DEFAULT_VB_W / DEFAULT_H
      if (containerAspect >= defaultAspect) {
        // Landscape (or close to it) — keep H at default, grow W to match.
        setVbW(Math.round(DEFAULT_H * containerAspect))
        setVbH(DEFAULT_H)
      } else {
        // Portrait — keep W at default, grow H to match.
        setVbW(DEFAULT_VB_W)
        setVbH(Math.round(DEFAULT_VB_W / containerAspect))
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Derived hub centerline — re-computed whenever the canvas resizes so
  // the hub + user-ring stay centered as vbH grows on portrait viewports.
  const HUB_Y = vbH / 2

  const [view, setView] = useState<View>(INITIAL_VIEW)
  const dragRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Per-node position overrides. When the user grabs a peer (or the hub)
  // and drags it, we record the resulting (x, y) in viewBox space here.
  // Subsequent renders prefer the override to the computed ring position.
  // Keyed by device id; the hub uses the literal key "__hub__".
  //
  // Two-layer persistence:
  //   - localStorage = fast-paint cache. Lazy initializer reads on mount
  //     so the chart paints the saved layout immediately (no flicker
  //     while the server fetch is in flight).
  //   - Server (GET /me/topology) = source of truth. When the response
  //     lands and differs from local, server wins (cross-device sync).
  //   - On every change, mirror to localStorage AND fire a debounced PUT
  //     so rapid drags coalesce into one network write.
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(
    () => loadNodePositions(),
  )

  // Server fetch — runs once per session, hydrates into state if it
  // diverges from the localStorage cache.
  const topologyQ = useQuery({
    queryKey: ["me", "topology"],
    queryFn: getMyTopology,
    staleTime: Infinity,
  })
  // Track whether we've already hydrated from this query response so we
  // don't overwrite an in-progress user drag with stale server state.
  const hydratedFromServerRef = useRef(false)
  useEffect(() => {
    if (!topologyQ.data || hydratedFromServerRef.current) return
    const server = topologyQ.data.positions
    const next = new Map<string, { x: number; y: number }>()
    for (const [id, pos] of Object.entries(server)) {
      next.set(id, { x: pos.x, y: pos.y })
    }
    hydratedFromServerRef.current = true
    setNodePositions(next)
    saveNodePositions(next)
  }, [topologyQ.data])

  // Debounced save: 500ms after the last change, PUT to server. Mirror to
  // localStorage on every change for the next refresh's fast-paint.
  const saveMut = useMutation({
    mutationFn: (positions: Map<string, { x: number; y: number }>) => {
      const obj: Record<string, { x: number; y: number }> = {}
      for (const [id, pos] of positions) obj[id] = pos
      return setMyTopology(obj)
    },
  })
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    saveNodePositions(nodePositions)
    // Don't fire a PUT before we've hydrated from the server — would
    // race with the initial GET and might overwrite the server copy
    // with the localStorage copy if they differ.
    if (!hydratedFromServerRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveMut.mutate(nodePositions)
    }, 500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodePositions])
  // While a node-drag is in flight: which node + its starting client/view
  // anchors. Set on pointerdown of a node, cleared on pointerup. While
  // non-null, the canvas-level pan handler is short-circuited so dragging
  // a node doesn't also pan the view.
  const nodeDragRef = useRef<{
    id: string
    startVx: number
    startVy: number
    baseX: number
    baseY: number
  } | null>(null)

  // Convert client (pixel) coordinates to viewBox (SVG user) coordinates,
  // so panning/zooming math stays in the same space as our laid-out nodes
  // regardless of the rendered element size.
  const clientToView = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: clientX, y: clientY }
    const rect = svg.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * vbW
    const y = ((clientY - rect.top) / rect.height) * vbH
    return { x, y }
  }, [vbW, vbH])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Ignore right/middle clicks so we don't fight context menus.
      if (e.button !== 0) return
      // Don't start a canvas-pan if a node grabbed the pointer first.
      if (nodeDragRef.current) return
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      const p = clientToView(e.clientX, e.clientY)
      dragRef.current = { startX: p.x, startY: p.y, tx: view.tx, ty: view.ty }
      setIsDragging(true)
    },
    [clientToView, view.tx, view.ty],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Node-drag has priority — convert pointer to scene coords and
      // write the new position into the overrides map.
      const nd = nodeDragRef.current
      if (nd) {
        const p = clientToView(e.clientX, e.clientY)
        // Convert from viewport space → scene space (undo the pan/zoom
        // applied by the transformed <g>). Same inverse the wheel-zoom
        // handler uses for cursor anchoring.
        const sx = (p.x - view.tx) / view.scale
        const sy = (p.y - view.ty) / view.scale
        const dx = sx - nd.startVx
        const dy = sy - nd.startVy
        const nx = nd.baseX + dx
        const ny = nd.baseY + dy
        setNodePositions((prev) => {
          const next = new Map(prev)
          next.set(nd.id, { x: nx, y: ny })
          return next
        })
        return
      }
      const d = dragRef.current
      if (!d) return
      const p = clientToView(e.clientX, e.clientY)
      setView((v) => ({
        ...v,
        tx: d.tx + (p.x - d.startX),
        ty: d.ty + (p.y - d.startY),
      }))
    },
    [clientToView, view.tx, view.ty, view.scale],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
    nodeDragRef.current = null
    setIsDragging(false)
  }, [])

  /** Begin dragging a single node. Captures the pointer on the SVG so
   *  subsequent move events still hit our canvas-level handler (which is
   *  where the node-drag branch lives) even as the cursor leaves the node
   *  shape. Stops propagation so the canvas-pan handler doesn't also fire. */
  const beginNodeDrag = useCallback(
    (
      e: React.PointerEvent<SVGGElement>,
      id: string,
      baseX: number,
      baseY: number,
    ) => {
      if (e.button !== 0) return
      e.stopPropagation()
      // Capture on the SVG, not the <g>, so onPointerMove on the SVG keeps
      // firing while we drag. Without this, capture happens on the <g>
      // and move events skip the SVG handler.
      svgRef.current?.setPointerCapture?.(e.pointerId)
      const p = clientToView(e.clientX, e.clientY)
      const sx = (p.x - view.tx) / view.scale
      const sy = (p.y - view.ty) / view.scale
      nodeDragRef.current = { id, startVx: sx, startVy: sy, baseX, baseY }
    },
    [clientToView, view.tx, view.ty, view.scale],
  )

  // Wheel zoom — keep the point under the cursor anchored. Capture native
  // wheel via a non-passive listener so we can preventDefault and avoid
  // the page scrolling while zooming the graph.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const cx = ((e.clientX - rect.left) / rect.width) * vbW
      const cy = ((e.clientY - rect.top) / rect.height) * vbH
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
  }, [vbW, vbH])

  const zoom = (factor: number) => {
    setView((v) => {
      const nextScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
      // Zoom around the SVG center to keep the action predictable when the
      // user hits the +/- buttons.
      const cx = vbW / 2
      const cy = vbH / 2
      const k = nextScale / v.scale
      return {
        tx: cx - (cx - v.tx) * k,
        ty: cy - (cy - v.ty) * k,
        scale: nextScale,
      }
    })
  }

  const resetView = () => {
    setView(INITIAL_VIEW)
    setNodePositions(new Map())
  }

  // "Full view": expand the topology to cover the browser window (NOT
  // the OS-level Fullscreen API). The wrap goes fixed inset-0 with a
  // high z-index so the chrome — sidebar, top bar, page header — stays
  // around just hidden behind it. Esc exits.
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v)
  }, [])

  useEffect(() => {
    if (!isFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false)
    }
    // Prevent the page underneath from scrolling while in full view.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener("keydown", onKey)
    }
  }, [isFullscreen])

  const visible = useMemo(() => {
    const live = devices.filter((d) => d.status !== "revoked")
    return live.slice(0, MAX_PEERS)
  }, [devices])

  const hidden = Math.max(0, devices.filter((d) => d.status !== "revoked").length - visible.length)

  // Group devices by their owning user. Each unique user_id becomes a
  // node on the inner ring; their devices cluster around them on a
  // small sub-ring.
  const userGroups = useMemo(() => {
    const groups = new Map<string, PublicDevice[]>()
    for (const d of visible) {
      const key = d.user_id
      const list = groups.get(key) ?? []
      list.push(d)
      groups.set(key, list)
    }
    // Cap user count for sanity in admin-wide views; the rest drop off the
    // graph but the HUD count still reflects them.
    const entries = [...groups.entries()].slice(0, MAX_USERS)
    return entries
  }, [visible])

  const placedUsers: LaidOutUser[] = useMemo(() => {
    const n = userGroups.length
    if (n === 0) return []
    return userGroups.map(([userId, userDevices], i) => {
      // Single-user case: park the user directly above the hub so the
      // 2-level tree reads top-down for the common dashboard view.
      const a = n === 1 ? -Math.PI / 2 : angleFor(userId, n, i)
      const computedX = vbW / 2 + Math.cos(a) * USER_RING
      const computedY = HUB_Y + Math.sin(a) * USER_RING * 0.62
      const override = nodePositions.get(`user-${userId}`)
      const x = override?.x ?? computedX
      const y = override?.y ?? computedY
      const label = userMap?.get(userId)?.label ?? `user · ${userId.slice(0, 6)}`
      let liveCount = 0
      for (const d of userDevices) {
        if (
          connState(d) === "online" &&
          ((rates.get(d.id)?.rxBps ?? 0) + (rates.get(d.id)?.txBps ?? 0)) > 1024
        ) {
          liveCount += 1
        }
      }
      return {
        userId,
        label,
        x,
        y,
        liveCount,
        peerCount: userDevices.length,
      }
    })
  }, [userGroups, nodePositions, vbW, vbH, userMap, rates])

  const placed: LaidOutPeer[] = useMemo(() => {
    if (placedUsers.length === 0) return []
    const out: LaidOutPeer[] = []
    for (const u of placedUsers) {
      const userDevices = userGroups.find(([id]) => id === u.userId)?.[1] ?? []
      const k = userDevices.length
      userDevices.forEach((d, idx) => {
        const online = connState(d) === "online"
        const rate = online ? rates.get(d.id) : undefined
        const rateBps = (rate?.rxBps ?? 0) + (rate?.txBps ?? 0)
        const hasTraffic = rateBps > 1024
        const tone = toneFor(d.status, online, hasTraffic)
        // Distribute this user's devices on a small ring centered on the
        // *default* user-node position (so dragging the user doesn't drag
        // the whole sub-ring with it — same idiom as hub vs peer ring).
        const a = k === 1 ? Math.PI / 2 : angleFor(d.id, k, idx)
        const defaultUserX =
          vbW / 2 +
          Math.cos(
            placedUsers.length === 1
              ? -Math.PI / 2
              : angleFor(u.userId, placedUsers.length, placedUsers.indexOf(u)),
          ) * USER_RING
        const defaultUserY =
          HUB_Y +
          Math.sin(
            placedUsers.length === 1
              ? -Math.PI / 2
              : angleFor(u.userId, placedUsers.length, placedUsers.indexOf(u)),
          ) *
            USER_RING *
            0.62
        const computedX = defaultUserX + Math.cos(a) * PEER_FROM_USER
        const computedY = defaultUserY + Math.sin(a) * PEER_FROM_USER * 0.62
        const override = nodePositions.get(d.id)
        const x = override?.x ?? computedX
        const y = override?.y ?? computedY
        out.push({
          device: d,
          x,
          y,
          tone,
          rateBps,
          userX: u.x,
          userY: u.y,
        })
      })
    }
    return out
  }, [placedUsers, userGroups, rates, nodePositions, vbW, vbH])

  // Hub position can also be overridden by drag. Default to canvas center.
  const hubOverride = nodePositions.get("__hub__")
  const hubX = hubOverride?.x ?? vbW / 2
  const hubY = hubOverride?.y ?? HUB_Y

  // Inverse-scale glyph stroke widths so icons + lines don't get heavy when
  // zoomed out and don't get hair-thin when zoomed in. Capped so things stay
  // readable at extreme scales.
  const strokeScale = clamp(1 / view.scale, 0.5, 2)

  return (
    <div
      ref={wrapRef}
      className={
        isFullscreen
          ? // "Full view": fixed-position overlay covering the window.
            // z-50 floats above the sidebar/top-bar without going over
            // toasts (which use z-[100]+). bg-background hides the page
            // chrome behind so the topology reads cleanly.
            "zv-livetopo-wrap fixed inset-0 z-50 bg-background"
          : "zv-livetopo-wrap relative h-full w-full"
      }
    >
      <svg
        ref={svgRef}
        className={`zv-topo zv-livetopo ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        // Dynamic viewBox width matches the container's aspect ratio so the
        // default `xMidYMid meet` neither letterboxes (the old "fit"
        // problem) nor stretches axes (the previous `none` workaround that
        // turned circles into ovals).
        viewBox={`0 0 ${vbW} ${vbH}`}
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
          width={vbW}
          height={vbH}
          fill="url(#zv-livetopo-grid)"
          opacity="0.55"
          className="text-border"
        />

        <g
          transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          style={{ vectorEffect: "non-scaling-stroke" }}
        >
          {/* server → user edges (thicker, always "live") */}
          {placedUsers.map((u) => (
            <g key={`hu-${u.userId}`}>
              <line
                x1={hubX}
                y1={hubY}
                x2={u.x}
                y2={u.y}
                className={
                  u.liveCount > 0 ? "zv-topo-edge-live" : "zv-topo-edge"
                }
                strokeWidth={1.1 * strokeScale}
              />
              {u.liveCount > 0 && (
                <line
                  className="zv-topo-flow"
                  x1={hubX}
                  y1={hubY}
                  x2={u.x}
                  y2={u.y}
                  strokeWidth={1.4 * strokeScale}
                  strokeDasharray="2 6"
                  style={{ animationDuration: "1.8s" }}
                />
              )}
            </g>
          ))}

          {/* user → device edges + per-device flow particles */}
          {placed.map((p) => {
            const isLive = p.tone === "live"
            return (
              <g key={`e-${p.device.id}`}>
                <line
                  x1={p.userX}
                  y1={p.userY}
                  x2={p.x}
                  y2={p.y}
                  className={isLive ? "zv-topo-edge-live" : "zv-topo-edge"}
                  strokeWidth={0.8 * strokeScale}
                />
                {isLive && (
                  <line
                    className="zv-topo-flow"
                    x1={p.userX}
                    y1={p.userY}
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

          {/* peers — draggable. PeerNode no longer needs hubX (label
              anchor is now relative to the user, not the hub). */}
          {placed.map((p) => (
            <PeerNode
              key={p.device.id}
              peer={p}
              hubX={p.userX}
              onPointerDown={(e) => beginNodeDrag(e, p.device.id, p.x, p.y)}
            />
          ))}

          {/* user-tier nodes — drawn on top of peer edges but under the hub */}
          {placedUsers.map((u) => (
            <UserNode
              key={u.userId}
              user={u}
              onPointerDown={(e) =>
                beginNodeDrag(e, `user-${u.userId}`, u.x, u.y)
              }
            />
          ))}

          {/* hub on top, last so it overlaps incoming edges — also draggable */}
          <HubNode
            tick={tick}
            label={serverLabel}
            meta={serverMeta}
            peerCount={placed.length}
            hidden={hidden}
            hubX={hubX}
            hubY={hubY}
            onPointerDown={(e) => beginNodeDrag(e, "__hub__", hubX, hubY)}
          />
        </g>

        {/* HUD — sits in screen-space (outside the transformed group) so
            metrics stay anchored to the corner under any zoom level */}
        <g transform={`translate(${vbW - 200}, 20)`} className="zv-topo-meta">
          <text fontSize="9">
            PEERS · {placed.filter((p) => p.tone === "live").length}/
            {devices.filter((d) => d.status !== "revoked").length}
          </text>
          <text fontSize="9" y={12}>
            USERS · {placedUsers.length}
          </text>
          <text fontSize="9" y={24}>
            HUBS · 1
          </text>
          <text fontSize="9" y={36}>
            ZOOM · {view.scale.toFixed(2)}×
          </text>
        </g>
      </svg>

      {/* Pan/zoom controls — keep them small + tucked in the bottom-right
          so the canvas stays uncluttered. Reset clears node-drag overrides
          too, so users can always undo a layout they don't like. */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <WithTooltip
          side="left"
          label={isFullscreen ? "Exit fullscreen" : "Open fullscreen"}
        >
          <button
            type="button"
            aria-label={isFullscreen ? "Exit fullscreen" : "Open fullscreen"}
            className="zv-icon-btn bg-card"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <IconArrowsMinimize size={14} />
            ) : (
              <IconArrowsMaximize size={14} />
            )}
          </button>
        </WithTooltip>
        <WithTooltip side="left" label="Zoom in">
          <button
            type="button"
            aria-label="Zoom in"
            className="zv-icon-btn bg-card"
            onClick={() => zoom(1.25)}
            disabled={view.scale >= MAX_SCALE}
          >
            <IconPlus size={14} />
          </button>
        </WithTooltip>
        <WithTooltip side="left" label="Zoom out">
          <button
            type="button"
            aria-label="Zoom out"
            className="zv-icon-btn bg-card"
            onClick={() => zoom(0.8)}
            disabled={view.scale <= MIN_SCALE}
          >
            <IconMinus size={14} />
          </button>
        </WithTooltip>
        <WithTooltip side="left" label="Reset view + clear node positions">
          <button
            type="button"
            aria-label="Reset view"
            className="zv-icon-btn bg-card"
            onClick={resetView}
            disabled={
              view.tx === 0 &&
              view.ty === 0 &&
              view.scale === 1 &&
              nodePositions.size === 0
            }
          >
            <IconFocusCentered size={14} />
          </button>
        </WithTooltip>
      </div>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

// ---------------------------------------------------------------------------
// Position persistence
// ---------------------------------------------------------------------------

const POS_STORAGE_KEY = "zerovpn.topology.positions.v1"

/** Read the saved drag-overrides on mount. Wrapped in try/catch because
 *  localStorage can throw in private mode / when storage is full, and we
 *  don't want a storage failure to crash the dashboard. */
function loadNodePositions(): Map<string, { x: number; y: number }> {
  if (typeof window === "undefined") return new Map()
  try {
    const raw = window.localStorage.getItem(POS_STORAGE_KEY)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw) as Record<string, { x: number; y: number }>
    const map = new Map<string, { x: number; y: number }>()
    for (const [id, pos] of Object.entries(parsed)) {
      if (
        pos &&
        typeof pos.x === "number" &&
        typeof pos.y === "number" &&
        Number.isFinite(pos.x) &&
        Number.isFinite(pos.y)
      ) {
        map.set(id, { x: pos.x, y: pos.y })
      }
    }
    return map
  } catch {
    return new Map()
  }
}

/** Mirror the overrides back to localStorage. Called from a useEffect on
 *  every change so a refresh after a drag lands on the same layout. */
function saveNodePositions(positions: Map<string, { x: number; y: number }>): void {
  if (typeof window === "undefined") return
  try {
    if (positions.size === 0) {
      window.localStorage.removeItem(POS_STORAGE_KEY)
      return
    }
    const obj: Record<string, { x: number; y: number }> = {}
    for (const [id, pos] of positions) obj[id] = pos
    window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(obj))
  } catch {
    // ignore — quota / private mode
  }
}

function HubNode({
  tick,
  label,
  meta,
  peerCount,
  hidden,
  hubX,
  hubY,
  onPointerDown,
}: {
  tick: number
  label: string
  meta?: string
  peerCount: number
  hidden: number
  hubX: number
  hubY: number
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void
}) {
  return (
    <g
      transform={`translate(${hubX}, ${hubY})`}
      onPointerDown={onPointerDown}
      style={{ cursor: "grab" }}
    >
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

/** Intermediate node between the server hub and a peer's devices. Sized
 *  between hub (28) and peer (14) so the visual hierarchy reads
 *  server > user > device at a glance. Tone follows whether any of the
 *  user's devices are currently transmitting. */
function UserNode({
  user,
  onPointerDown,
}: {
  user: LaidOutUser
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void
}) {
  const tone = user.liveCount > 0 ? "live" : "idle"
  const strokeClass =
    tone === "live" ? "zv-topo-peer-live" : "zv-topo-peer-idle"
  return (
    <g
      transform={`translate(${user.x}, ${user.y})`}
      className="zv-topo-peer"
      onPointerDown={onPointerDown}
      style={{ cursor: "grab" }}
    >
      <circle r={18} className={strokeClass} strokeWidth="1.4" />
      <g transform="translate(-9, -9)" className="zv-topo-peer-icon">
        <IconUser size={18} strokeWidth={1.6} />
      </g>
      <text x={0} y={32} textAnchor="middle" className="zv-topo-hub-label">
        {user.label}
      </text>
      <text x={0} y={44} textAnchor="middle" className="zv-topo-meta">
        {user.peerCount} {user.peerCount === 1 ? "device" : "devices"}
      </text>
    </g>
  )
}

function PeerNode({
  peer,
  hubX,
  onPointerDown,
}: {
  peer: LaidOutPeer
  hubX: number
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void
}) {
  const Shape = shapeFor(peer.device.os)
  const Brand = iconFor(peer.device.os)
  const strokeClass =
    peer.tone === "live"
      ? "zv-topo-peer-live"
      : peer.tone === "paused"
        ? "zv-topo-peer-paused"
        : "zv-topo-peer-idle"
  const labelAnchor: "start" | "end" = peer.x >= hubX ? "start" : "end"
  const labelDx = labelAnchor === "start" ? 18 : -18
  return (
    <g
      transform={`translate(${peer.x}, ${peer.y})`}
      className="zv-topo-peer"
      onPointerDown={onPointerDown}
      style={{ cursor: "grab" }}
    >
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
