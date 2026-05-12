import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import {
  CodeBlock,
  Eyebrow,
  Kbd,
  LiveDot,
  Wordmark,
} from "@/components/swiss"
import { LiveBackbone } from "@/components/topology/LiveBackbone"
import { Button } from "@/components/ui/button"
import { ping } from "@/lib/api"

/**
 * Swiss one-pager landing — strict grid, hairline section dividers,
 * mono eyebrows, oversized display headline, a feature grid that paints
 * itself with rules instead of cards, and a deploy section with a copy-
 * able compose snippet. Matches landing.jsx in the design bundle.
 */
export function LandingPage() {
  const pingQ = useQuery({
    queryKey: ["ping"],
    queryFn: ping,
    refetchInterval: 5000,
  })

  return (
    <div className="bg-background text-foreground">
      <nav className="bg-background sticky top-0 z-10 flex items-center gap-6 border-b px-6 py-4">
        <Link to="/">
          <Wordmark size={13} />
        </Link>
        <div className="ml-auto hidden items-center gap-6 font-mono text-xs text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <a href="#deploy" className="hover:text-foreground">
            Deploy
          </a>
          <Link to="/forgot-password" className="hover:text-foreground">
            Recovery
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/register">Get started</Link>
          </Button>
        </div>
      </nav>

      {/* HERO */}
      <section className="zv-grid-bg grid grid-cols-1 gap-12 border-b px-6 pt-14 lg:grid-cols-2">
        <div className="flex flex-col gap-4 pb-16">
          <Eyebrow num="01">Self-hosted · WireGuard · No-logs</Eyebrow>
          <h1 className="font-heading text-5xl font-medium leading-[0.92] tracking-[-0.04em] sm:text-6xl lg:text-7xl">
            Run your own
            <br />
            VPN.
            <br />
            <em className="text-muted-foreground block font-mono text-[0.65em] font-normal not-italic tracking-[-0.02em]">
              — without running a fleet.
            </em>
          </h1>
          <p className="text-muted-foreground mt-4 max-w-[44ch] text-base leading-relaxed">
            ZeroVPN is a privacy-first WireGuard control plane you deploy in
            fifteen minutes. Manage devices, peers, and admin policy from one
            quiet, fast console. Live telemetry. No traffic logs. No SaaS in
            the path.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link to="/register">Deploy ZeroVPN ↗</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link to="/login">Live demo</Link>
            </Button>
            <Kbd className="ml-2">docker compose up -d</Kbd>
          </div>

          <div className="mt-10 flex flex-wrap gap-6 font-mono text-[11px] text-muted-foreground">
            <ApiPill state={pingQ.status} ts={pingQ.data?.ts_ms as number | undefined} />
            <span>
              <b className="text-foreground">15min</b> install
            </span>
            <span>
              <b className="text-foreground">0</b> traffic logs
            </span>
            <span>
              <b className="text-foreground">v1.0.20240310</b>
            </span>
          </div>
        </div>

        {/* hero side panel — animated SVG backbone matching design FIG. 01 */}
        <div className="border-border relative -mr-6 hidden border-l lg:block">
          <div className="absolute inset-0">
            <LiveBackbone live />
          </div>
          <div className="text-muted-foreground absolute left-4 top-4 font-mono text-[10px] tracking-wide">
            FIG. 01 · LIVE BACKBONE
          </div>
        </div>
      </section>

      {/* FEATURE GRID — 8 blocks, 12-col, span 3 each (4 per row on lg) */}
      <section id="features" className="grid grid-cols-2 border-b lg:grid-cols-4">
        {[
          { n: "02", h: "WireGuard, properly", b: "Wire-fast VPN protocol with the boring parts handled — keypair lifecycle, IP allocation, recycle on revoke, AmneziaWG params." },
          { n: "03", h: "Real-time telemetry", b: "Worker → ZeroMQ → API → WebSocket. Sub-second device state, live rates, topology you can actually trust." },
          { n: "04", h: "First-class admin", b: "Suspend, quota, audit, force key-rotation. CSV exports for compliance reviews." },
          { n: "05", h: "Privacy by default", b: "No traffic-content logging. Argon2 + KEK-encrypted secrets. Container-hardened. Backup with optional age." },
          { n: "06", h: "Self-hosted, period", b: "Single docker compose stack. Postgres + Redis + Caddy. Optional observability profile (Prom/Grafana/Loki)." },
          { n: "07", h: "TOTP & recovery", b: "2FA enroll/disable, recovery codes, brute-force mitigation, must-change-password flow, email-verification." },
          { n: "08", h: "Per-device policy", b: "Split-tunnel with allowed-IP override. Custom DNS. Friendly DNS names. QR onboarding for mobile." },
          { n: "09", h: "OpenAPI + tokens", b: "Hand-curated OpenAPI spec. Scoped API tokens with one-time plaintext reveal." },
        ].map((f, i, all) => (
          <div
            key={f.n}
            className={[
              "flex min-h-[200px] flex-col gap-2 p-6",
              (i + 1) % 2 !== 0 && "border-r lg:border-r",
              (i + 1) % 4 !== 0 && "lg:border-r",
              i < all.length - 2 && "border-b",
              "border-border",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="zv-eyebrow">{f.n}</div>
            <h3 className="font-heading mt-2 text-lg font-medium tracking-[-0.01em]">
              {f.h}
            </h3>
            <p className="text-muted-foreground m-0 text-[13px] leading-relaxed">
              {f.b}
            </p>
          </div>
        ))}
      </section>

      {/* DEPLOY */}
      <section
        id="deploy"
        className="grid grid-cols-1 border-b lg:grid-cols-2"
      >
        <div className="border-border border-b p-8 lg:border-b-0 lg:border-r">
          <Eyebrow num="10">Deploy</Eyebrow>
          <h2 className="font-heading mt-3 text-4xl font-medium tracking-[-0.02em]">
            Boring, repeatable, fast.
          </h2>
          <p className="text-muted-foreground mt-4 max-w-[44ch] text-sm leading-relaxed">
            One compose file with optional profiles. Bring your own Linux box,
            or scale across regions. The runbook walks you through setup,
            restore drills, and the security checklist.
          </p>
          <div className="mt-6 flex flex-col gap-3 font-mono text-xs">
            {[
              ["00:00", "git clone & cp .env.example"],
              ["00:02", "docker compose --profile wg up -d"],
              ["00:08", "First user → admin · TOTP setup"],
              ["00:11", "Add device · scan QR · connected"],
              ["00:15", "Live topology · timeline · audit"],
            ].map(([t, b]) => (
              <div key={t} className="flex items-center gap-3">
                <span className="text-muted-foreground/60 w-12">{t}</span>
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-8">
          <CodeBlock>{`# docker-compose.yml — minimal
services:
  api:     { image: zerovpn/api:1.0,     ports: ["443"] }
  worker:  { image: zerovpn/worker:1.0,  network_mode: host }
  db:      { image: postgres:16-alpine                     }
  redis:   { image: redis:7-alpine                         }
  caddy:   { image: caddy:2                                }

# optional profile: wireguard kernel + dnsmasq
# optional profile: prometheus + grafana + loki + promtail
# optional profile: backup container w/ age encryption`}</CodeBlock>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b px-6 py-20 text-center">
        <Eyebrow num="11" className="justify-center">
          Ready
        </Eyebrow>
        <h2 className="font-heading mt-4 text-5xl font-medium tracking-[-0.03em] sm:text-6xl">
          Stop renting your privacy.
        </h2>
        <p className="text-muted-foreground mx-auto mt-4 max-w-[60ch] text-base">
          Self-host in fifteen minutes. Open source, MIT-licensed.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/register">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link to="/login">See live demo</Link>
          </Button>
        </div>
      </section>

      <footer className="grid grid-cols-2 gap-8 p-6 font-mono text-xs text-muted-foreground sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Wordmark size={11} />
          <span>MIT · {new Date().getFullYear()}</span>
        </div>
        <div className="flex flex-col gap-1">
          <b className="text-foreground font-medium">PRODUCT</b>
          <span>Features</span>
          <span>Topology</span>
          <span>Roadmap</span>
        </div>
        <div className="flex flex-col gap-1">
          <b className="text-foreground font-medium">DOCS</b>
          <span>Install</span>
          <span>Runbook</span>
          <span>OpenAPI</span>
        </div>
        <div className="flex flex-col gap-1">
          <b className="text-foreground font-medium">OPS</b>
          <span>Status</span>
          <span>Security</span>
          <span>Privacy</span>
        </div>
      </footer>
    </div>
  )
}

function ApiPill({ state, ts }: { state: string; ts?: number }) {
  const dotState =
    state === "success" ? "live" : state === "error" ? "offline" : "warn"
  const label =
    state === "success"
      ? `api ok${ts ? " · " + new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`
      : state === "error"
        ? "api down"
        : "pinging…"
  return (
    <span className="inline-flex items-center gap-1.5">
      <LiveDot state={dotState as "live" | "offline" | "warn"} />
      <span>{label}</span>
    </span>
  )
}
