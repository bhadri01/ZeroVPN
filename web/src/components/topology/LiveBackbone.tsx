import { useEffect, useState } from "react"

const HUBS = [
  { id: "fra-01", x: 0.30, y: 0.40, label: "fra-01", country: "DE", peers: 14 },
  { id: "ams-02", x: 0.40, y: 0.20, label: "ams-02", country: "NL", peers: 9 },
  { id: "iad-01", x: 0.18, y: 0.55, label: "iad-01", country: "US", peers: 11 },
  { id: "sgp-01", x: 0.78, y: 0.62, label: "sgp-01", country: "SG", peers: 6 },
  { id: "syd-01", x: 0.86, y: 0.82, label: "syd-01", country: "AU", peers: 3 },
] as const

const PEERS = [
  { id: "p1", hub: "fra-01", x: 0.55, y: 0.30, label: "macbook-pro-arvid", live: true },
  { id: "p2", hub: "fra-01", x: 0.45, y: 0.55, label: "iphone-arvid", live: true },
  { id: "p3", hub: "fra-01", x: 0.20, y: 0.30, label: "ipad-arvid", live: false },
  { id: "p4", hub: "ams-02", x: 0.55, y: 0.10, label: "linux-server-home", live: true },
  { id: "p5", hub: "ams-02", x: 0.30, y: 0.05, label: "nas-synology", live: true },
  { id: "p6", hub: "iad-01", x: 0.04, y: 0.42, label: "iad-peer-04", live: true },
  { id: "p7", hub: "iad-01", x: 0.08, y: 0.72, label: "iad-peer-09", live: true },
  { id: "p8", hub: "sgp-01", x: 0.92, y: 0.50, label: "pixel-backup", live: true },
  { id: "p9", hub: "sgp-01", x: 0.94, y: 0.74, label: "sgp-peer-02", live: true },
  { id: "p10", hub: "syd-01", x: 0.96, y: 0.90, label: "syd-peer-01", live: true },
] as const

const BACKBONE: ReadonlyArray<readonly [string, string]> = [
  ["fra-01", "ams-02"],
  ["fra-01", "iad-01"],
  ["ams-02", "iad-01"],
  ["fra-01", "sgp-01"],
  ["sgp-01", "syd-01"],
  ["iad-01", "sgp-01"],
]

const HUB_MAP = Object.fromEntries(HUBS.map((h) => [h.id, h]))

const W = 1000
const H = 560
const px = (n: number) => n * W
const py = (n: number) => n * H

function seedRand(s: number) {
  const x = Math.sin(s * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

interface LiveBackboneProps {
  live?: boolean
}

export function LiveBackbone({ live = true }: LiveBackboneProps) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [live])

  const livePeers = PEERS.filter((p) => p.live).length

  return (
    <svg
      className="zv-topo"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="zv-topo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect
        width={W}
        height={H}
        fill="url(#zv-topo-grid)"
        opacity="0.6"
        className="text-border"
      />

      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
        <text
          key={"tx" + i}
          x={px(t) + 4}
          y={14}
          className="zv-topo-meta"
          fontSize="9"
        >
          {(t * 180 - 90).toFixed(0)}°
        </text>
      ))}

      {BACKBONE.map(([a, b], i) => {
        const A = HUB_MAP[a]
        const B = HUB_MAP[b]
        return (
          <line
            key={i}
            x1={px(A.x)}
            y1={py(A.y)}
            x2={px(B.x)}
            y2={py(B.y)}
            className="zv-topo-backbone"
            strokeWidth="0.8"
          />
        )
      })}

      {PEERS.map((p) => {
        const hub = HUB_MAP[p.hub]
        return (
          <g key={p.id}>
            <line
              x1={px(hub.x)}
              y1={py(hub.y)}
              x2={px(p.x)}
              y2={py(p.y)}
              className={p.live ? "zv-topo-edge-live" : "zv-topo-edge"}
              strokeWidth="0.8"
            />
            {p.live && (
              <line
                className="zv-topo-flow"
                x1={px(hub.x)}
                y1={py(hub.y)}
                x2={px(p.x)}
                y2={py(p.y)}
                strokeWidth="1.2"
                strokeDasharray="2 5"
                style={{ animationDuration: 1.2 + seedRand(p.id.charCodeAt(1)) + "s" }}
              />
            )}
            <g transform={`translate(${px(p.x)},${py(p.y)})`}>
              <circle
                r="3.5"
                className={p.live ? "zv-topo-node-live" : "zv-topo-node"}
                strokeWidth="1"
              />
              <text x="6" y="3" className="zv-topo-meta">
                {p.label}
              </text>
            </g>
          </g>
        )
      })}

      {HUBS.map((h) => (
        <g key={h.id} transform={`translate(${px(h.x)},${py(h.y)})`}>
          <circle
            r={18 + (tick % 2 === 0 ? 1 : 0)}
            className="zv-topo-halo"
            opacity="0.6"
          />
          <circle r="9" className="zv-topo-hub" strokeWidth="1.2" />
          <circle r="2.5" className="zv-topo-hub-dot" />
          <rect
            x="13"
            y="-9"
            width="68"
            height="14"
            className="zv-topo-hub-tag"
            strokeWidth="0.5"
          />
          <text x="17" y="1" className="zv-topo-hub-label" fontWeight="500">
            {h.label}
          </text>
          <text x="17" y="14" className="zv-topo-meta">
            {h.peers} peers
          </text>
          <text x="-30" y="22" className="zv-topo-meta">
            {h.country}
          </text>
        </g>
      ))}

      <g transform="translate(20,520)">
        <rect width="280" height="28" className="zv-topo-legend" strokeWidth="0.5" />
        <circle cx="14" cy="14" r="3.5" className="zv-topo-hub" strokeWidth="1" />
        <text x="24" y="18" className="zv-topo-meta zv-topo-meta-ink">
          hub
        </text>
        <line
          x1="60"
          y1="14"
          x2="76"
          y2="14"
          className="zv-topo-flow-static"
          strokeWidth="1.2"
          strokeDasharray="2 4"
        />
        <text x="82" y="18" className="zv-topo-meta zv-topo-meta-ink">
          live · flow
        </text>
        <line
          x1="160"
          y1="14"
          x2="176"
          y2="14"
          className="zv-topo-backbone"
          strokeWidth="1"
        />
        <text x="182" y="18" className="zv-topo-meta zv-topo-meta-ink">
          backbone
        </text>
      </g>

      <g transform={`translate(${W - 180},20)`}>
        <text className="zv-topo-meta" fontSize="9">
          PEERS · {livePeers}/{PEERS.length}
        </text>
        <text className="zv-topo-meta" fontSize="9" y={12}>
          HUBS · {HUBS.length}
        </text>
        <text className="zv-topo-meta" fontSize="9" y={24}>
          TICK · {String(tick).padStart(4, "0")}
        </text>
      </g>
    </svg>
  )
}
