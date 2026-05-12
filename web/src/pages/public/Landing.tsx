import { useQuery } from "@tanstack/react-query"
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react"
import { useEffect, useRef } from "react"
import { Link } from "react-router"

import {
  CodeBlock,
  Eyebrow,
  Kbd,
  LiveDot,
  Pill,
  Sparkline,
  Wordmark,
} from "@/components/swiss"
import { LiveBackbone } from "@/components/topology/LiveBackbone"
import { Button } from "@/components/ui/button"
import { ping } from "@/lib/api"
import { cardVariants, stagger } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * Editorial landing page.
 *
 * Layout rhythm: hero → numbers → personas → preview/feature/preview
 * sandwich → architecture → preview → deploy → security → compare →
 * roadmap → FAQ → CTA. Hairline rules give the Swiss bones; oversized
 * display type + asymmetric bento give the editorial feel.
 *
 * Motion:
 *  - Hero stagger-mounts on load.
 *  - Below-the-fold sections use `whileInView` so the cascade follows
 *    the user, not the page.
 *  - Hero has subtle ambient loops (drifting dots, blinking caret,
 *    counter shimmer) that disable themselves under `prefers-reduced-
 *    motion`.
 *  - Counters in the numbers strip animate up on first view.
 */
export function LandingPage() {
  const pingQ = useQuery({
    queryKey: ["ping"],
    queryFn: ping,
    refetchInterval: 5000,
  })

  return (
    <div className="bg-background text-foreground">
      <LandingNav />
      <Hero pingState={pingQ.status} pingTs={pingQ.data?.ts_ms as number | undefined} />
      <NumbersStrip />
      <Personas />
      <PreviewDashboard />
      <FeaturesBento />
      <PreviewTopology />
      <Architecture />
      <PreviewDeviceDetail />
      <Deploy />
      <Security />
      <Compare />
      <Roadmap />
      <FAQ />
      <CTA />
      <LandingFooter />
    </div>
  )
}

// ── Nav ───────────────────────────────────────────────────────────────

function LandingNav() {
  return (
    <nav className="bg-background/85 sticky top-0 z-20 flex items-center gap-6 border-b px-6 py-4 backdrop-blur">
      <Link to="/">
        <Wordmark size={13} />
      </Link>
      <div className="text-muted-foreground ml-auto hidden items-center gap-6 font-mono text-xs md:flex">
        {[
          ["#features", "Features"],
          ["#architecture", "Architecture"],
          ["#deploy", "Deploy"],
          ["#security", "Security"],
          ["#faq", "FAQ"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="hover:text-foreground transition-colors"
          >
            {label}
          </a>
        ))}
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
  )
}

// ── Hero ──────────────────────────────────────────────────────────────

function Hero({
  pingState,
  pingTs,
}: {
  pingState: string
  pingTs?: number
}) {
  const reduce = useReducedMotion()
  return (
    <section className="zv-grid-bg relative grid grid-cols-1 gap-8 overflow-hidden border-b px-5 pt-12 sm:gap-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
      <AmbientDots disabled={!!reduce} />

      <motion.div
        className="relative z-[1] flex flex-col gap-4 pb-12 sm:gap-5 sm:pb-20"
        initial="initial"
        animate="animate"
        variants={{ initial: {}, animate: { transition: stagger(0.06) } }}
      >
        <motion.div variants={cardVariants}>
          <Eyebrow num="01">Self-hosted · WireGuard · No-logs</Eyebrow>
        </motion.div>
        <motion.h1
          variants={cardVariants}
          className="font-heading text-[2.5rem] font-medium leading-[0.92] tracking-[-0.04em] sm:text-7xl sm:leading-[0.9] lg:text-[5.6rem]"
        >
          Run your own
          <br />
          VPN.
          <br />
          <span className="text-muted-foreground block font-mono text-[0.42em] font-normal tracking-[-0.01em] sm:text-[0.32em]">
            — without running a fleet.
          </span>
        </motion.h1>
        <motion.p
          variants={cardVariants}
          className="text-muted-foreground mt-2 max-w-[46ch] text-[15px] leading-relaxed sm:mt-3 sm:text-base"
        >
          A privacy-first WireGuard control plane you deploy in fifteen minutes.
          Manage devices, peers, and admin policy from one quiet, fast console.
          Live telemetry. No traffic logs. No SaaS in the path.
        </motion.p>
        <motion.div
          variants={cardVariants}
          className="mt-2 flex flex-wrap items-center gap-2 sm:mt-3 sm:gap-3"
        >
          <Button asChild size="lg">
            <Link to="/register">Deploy ZeroVPN ↗</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link to="/login">Live demo</Link>
          </Button>
          <Kbd className="hidden sm:ml-2 sm:inline-flex">
            docker compose up -d
            <BlinkCaret disabled={!!reduce} />
          </Kbd>
        </motion.div>

        <motion.div
          variants={cardVariants}
          className="text-muted-foreground mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] sm:mt-8 sm:gap-x-6"
        >
          <ApiPill state={pingState} ts={pingTs} />
          <span className="text-muted-foreground/40">·</span>
          <span>
            <b className="text-foreground">MIT</b> · open source
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span>
            <b className="text-foreground">Rust</b> · 1.81+
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span>
            <b className="text-foreground">0</b> trackers
          </span>
        </motion.div>
      </motion.div>

      <motion.div
        className="border-border relative -mr-6 hidden border-l lg:block"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.6, delay: 0.25 } }}
      >
        <div className="absolute inset-0">
          <LiveBackbone live={!reduce} />
        </div>
        <div className="text-muted-foreground absolute left-4 top-4 font-mono text-[10px] tracking-wide">
          FIG. 01 · LIVE BACKBONE
        </div>
        {!reduce && <ScanLine />}
      </motion.div>
    </section>
  )
}

function AmbientDots({ disabled }: { disabled: boolean }) {
  if (disabled) return null
  const dots = [
    { left: "8%", top: "22%", delay: 0 },
    { left: "26%", top: "12%", delay: 1.2 },
    { left: "14%", top: "62%", delay: 2.4 },
    { left: "36%", top: "78%", delay: 0.6 },
  ]
  return (
    <div className="pointer-events-none absolute inset-0 z-[0]" aria-hidden>
      {dots.map((d, i) => (
        <motion.span
          key={i}
          className="bg-primary/50 absolute size-1 rounded-full"
          style={{ left: d.left, top: d.top }}
          initial={{ opacity: 0, y: 0 }}
          animate={{
            opacity: [0, 0.7, 0],
            y: [0, -30, -60],
          }}
          transition={{
            duration: 6,
            delay: d.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  )
}

function BlinkCaret({ disabled }: { disabled: boolean }) {
  if (disabled) return <span className="text-primary ml-0.5">▍</span>
  return (
    <motion.span
      className="text-primary ml-0.5 inline-block"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
    >
      ▍
    </motion.span>
  )
}

function ScanLine() {
  return (
    <motion.div
      className="from-primary/60 pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r via-transparent to-transparent"
      initial={{ top: 0, opacity: 0 }}
      animate={{ top: ["0%", "100%"], opacity: [0, 0.8, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
    />
  )
}

// ── Numbers strip with animated counters ─────────────────────────────

function NumbersStrip() {
  const cells = [
    {
      to: 15,
      unit: "min",
      label: "deploy time",
      format: (v: number) => v.toFixed(0),
    },
    {
      to: 1,
      unit: "Hz",
      label: "telemetry tick",
      format: (v: number) => v.toFixed(0),
    },
    {
      to: 180,
      unit: "days",
      label: "audit retention",
      format: (v: number) => v.toFixed(0),
    },
    {
      to: 100,
      unit: "%",
      label: "self-hosted",
      format: (v: number) => v.toFixed(0),
    },
  ]
  return (
    <section className="border-b">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {cells.map((c, i, all) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.3, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "border-border flex flex-col items-start gap-1 p-5 sm:p-8",
              (i + 1) % 2 !== 0 && "border-r sm:border-r",
              (i + 1) % 4 !== 0 && "lg:border-r",
              i < all.length - 2 && "border-b lg:border-b-0",
            )}
          >
            <div className="font-heading text-foreground flex items-baseline gap-1 text-4xl font-medium tracking-[-0.03em] sm:text-5xl lg:text-6xl">
              <AnimatedCounter to={c.to} format={c.format} />
              <span className="text-muted-foreground/70 font-mono text-sm tracking-normal sm:text-base">
                {c.unit}
              </span>
            </div>
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide sm:text-[11px]">
              {c.label}
            </span>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function AnimatedCounter({
  to,
  format,
  duration = 1.2,
}: {
  to: number
  format: (v: number) => string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduce = useReducedMotion()
  const mv = useMotionValue(0)
  const display = useTransform(mv, (v) => format(v))

  useEffect(() => {
    if (!inView) return
    if (reduce) {
      mv.set(to)
      return
    }
    const controls = animate(mv, to, { duration, ease: [0.16, 1, 0.3, 1] })
    return () => controls.stop()
  }, [inView, to, duration, mv, reduce])

  return <motion.span ref={ref}>{display}</motion.span>
}

// ── Personas ──────────────────────────────────────────────────────────

function Personas() {
  const personas = [
    {
      n: "P/01",
      label: "Homelab tinkerer",
      blurb: "One box in your basement. Three devices. A NAS. A Pi.",
      gets: [
        "5-minute Docker bootstrap",
        "QR onboarding for mobile",
        "Live topology on a 4K TV",
      ],
    },
    {
      n: "P/02",
      label: "Small team",
      blurb: "10–50 peers. Real users. Real auditors.",
      gets: [
        "Admin · suspend · quota · key-rotate",
        "180-day audit log + CSV",
        "TOTP + recovery codes",
      ],
    },
    {
      n: "P/03",
      label: "Privacy operator",
      blurb: "You don't want anyone — even us — to see your traffic.",
      gets: [
        "Zero traffic-content logging",
        "KEK · AES-256-GCM at rest",
        "No SaaS in the data path",
      ],
    },
  ]
  return (
    <section className="border-b">
      <div className="border-border border-b px-5 py-10 sm:px-6 sm:py-12">
        <Eyebrow num="02">Built for</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[14ch] text-3xl font-medium tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          Three operators, one stack.
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3">
        {personas.map((p, i, all) => (
          <motion.div
            key={p.n}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.26, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "border-border flex flex-col gap-3 p-6 sm:p-8",
              i < all.length - 1 && "border-b md:border-b-0 md:border-r",
            )}
          >
            <span className="text-muted-foreground/70 font-mono text-[10px] uppercase tracking-wide">
              {p.n}
            </span>
            <h3 className="font-heading text-2xl font-medium tracking-[-0.015em]">
              {p.label}
            </h3>
            <p className="text-muted-foreground max-w-[34ch] text-sm leading-relaxed">
              {p.blurb}
            </p>
            <ul className="text-foreground mt-2 flex flex-col gap-2 font-mono text-[12px]">
              {p.gets.map((g) => (
                <li key={g} className="flex items-baseline gap-2">
                  <span className="text-primary">→</span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ── Preview 1: Dashboard ─────────────────────────────────────────────

function PreviewDashboard() {
  return (
    <section className="grid grid-cols-1 border-b lg:grid-cols-[1fr_1.4fr]">
      <motion.div
        className="border-border border-b p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-14"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <Eyebrow num="03">Console · Dashboard</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[16ch] text-3xl font-medium leading-[1.02] tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          One pane.
          <br />
          Every device.
        </h2>
        <p className="text-muted-foreground mt-4 max-w-[42ch] text-sm leading-relaxed sm:mt-5">
          KPIs that answer the boring questions immediately — how many peers
          are live, how fast they're moving, when they last handshook. Live
          rates flow over WebSocket from the worker at 1 Hz.
        </p>
        <div className="mt-5 flex flex-wrap gap-1.5 font-mono text-[10px] sm:mt-6">
          {["WebSocket · 1 Hz", "Hydrate from history", "EMA-smoothed rates", "TanStack Query"].map(
            (t) => (
              <span
                key={t}
                className="border-border text-muted-foreground border px-2 py-1"
              >
                {t}
              </span>
            ),
          )}
        </div>
      </motion.div>
      <motion.div
        className="bg-card/40 p-4 sm:p-6 lg:p-10"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.3, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
      >
        <MockDashboard />
      </motion.div>
    </section>
  )
}

function MockDashboard() {
  const rxHistory = sineWave(32, 32, 7, 0.3)
  const txHistory = sineWave(32, 28, 6, 0.55)
  return (
    <div className="border-border bg-background flex flex-col gap-4 border p-4">
      <div className="text-muted-foreground/70 flex items-center justify-between font-mono text-[10px] uppercase">
        <span>Workspace · 01 · Dashboard</span>
        <span className="inline-flex items-center gap-1.5">
          <LiveDot /> live
        </span>
      </div>
      <div className="grid grid-cols-2 gap-0 border sm:grid-cols-4">
        {[
          { l: "Devices · live", v: "4", f: "all active" },
          { l: "TX · live", v: "182", u: "Mb/s", spark: txHistory, c: "var(--primary)" },
          { l: "RX · live", v: "240", u: "Mb/s", spark: rxHistory, c: "var(--chart-1)" },
          { l: "Hubs", v: "3 / 3", f: "reachable" },
        ].map((k, i) => (
          <div
            key={k.l}
            className={cn(
              "flex flex-col gap-1 p-3",
              // 2×2 on mobile (right-border on the left column),
              // 1×4 on sm+ (right-border on cols 1-3).
              i % 2 === 0 && "border-r sm:border-r",
              i < 2 && "border-b sm:border-b-0",
              i === 2 && "sm:border-r",
            )}
          >
            <span className="text-muted-foreground font-mono text-[9px] uppercase">
              {k.l}
            </span>
            <span className="font-heading flex items-baseline gap-1 text-2xl tracking-[-0.02em]">
              {k.v}
              {k.u && (
                <span className="text-muted-foreground font-mono text-[10px]">{k.u}</span>
              )}
            </span>
            {k.spark && (
              <div className="h-[22px]">
                <Sparkline data={k.spark} color={k.c} />
              </div>
            )}
            {k.f && (
              <span className="text-muted-foreground/70 font-mono text-[9px]">
                {k.f}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="border p-3">
        <div className="text-muted-foreground/70 mb-1 flex items-center justify-between font-mono text-[9px] uppercase">
          <span>Bandwidth · 24h · all devices</span>
          <span>live</span>
        </div>
        <FauxDualChart rx={rxHistory} tx={txHistory} />
      </div>
      <div className="flex flex-col gap-1.5 border p-3">
        <span className="text-muted-foreground/70 font-mono text-[9px] uppercase">
          Recent activity · 4
        </span>
        {[
          { t: "00:12", d: "device.added · macbook-pro", tone: "ok" as const },
          { t: "00:08", d: "device.online · pixel-8", tone: "info" as const },
          { t: "00:04", d: "key.rotated · ipad", tone: "warn" as const },
          { t: "00:01", d: "device.offline · nas", tone: "neutral" as const },
        ].map((r) => (
          <div
            key={r.t}
            className="flex items-baseline gap-3 font-mono text-[11px]"
          >
            <span className="text-muted-foreground/70 w-10">{r.t}</span>
            <Pill tone={r.tone} dot={false}>
              {r.d}
            </Pill>
          </div>
        ))}
      </div>
    </div>
  )
}

function FauxDualChart({ rx, tx }: { rx: number[]; tx: number[] }) {
  return (
    <div className="h-[120px]">
      <svg
        viewBox="0 0 100 60"
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%" }}
      >
        <path d={pathArea(rx, 100, 60)} fill="var(--chart-1)" opacity="0.15" />
        <path
          d={pathLine(rx, 100, 60)}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
        <path d={pathArea(tx, 100, 60)} fill="var(--primary)" opacity="0.15" />
        <path
          d={pathLine(tx, 100, 60)}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

// ── Bento features ───────────────────────────────────────────────────

function FeaturesBento() {
  return (
    <section id="features" className="border-b">
      <div className="border-border border-b px-5 py-10 sm:px-6 sm:py-12">
        <Eyebrow num="04">Features</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[18ch] text-3xl font-medium tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          The boring parts. Handled.
        </h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-4 lg:grid-rows-3">
        <BentoCard
          className="lg:col-span-2 lg:row-span-2"
          n="04.1"
          h="Real-time telemetry"
          b="Worker → ZeroMQ → API → WebSocket. Tick-level samples written to a partitioned Postgres table and replayed on refresh, so the chart isn't empty when you reload."
          accent
        >
          <div className="mt-6 grid grid-cols-2 gap-3">
            <MiniStat label="latency" value="<200" unit="ms" />
            <MiniStat label="tick rate" value="1" unit="Hz" />
          </div>
          <div className="mt-4 h-[80px]">
            <Sparkline
              data={sineWave(48, 30, 6, 0.4)}
              color="var(--primary)"
              kind="area"
              height={80}
            />
          </div>
        </BentoCard>
        <BentoCard
          n="04.2"
          h="WireGuard, properly"
          b="Keypair lifecycle, IP allocation, recycle on revoke. AmneziaWG params first-class."
        />
        <BentoCard
          n="04.3"
          h="Privacy by default"
          b="No traffic-content logging. Argon2 + KEK-encrypted secrets at rest."
        />
        <BentoCard
          n="04.4"
          h="First-class admin"
          b="Suspend, quota, audit, key-rotation. CSV exports."
        />
        <BentoCard
          n="04.5"
          h="TOTP & recovery"
          b="RFC 6238. Hashed recovery codes. Brute-force shield."
        />
        <BentoCard
          className="lg:col-span-2"
          n="04.6"
          h="Self-hosted, period"
          b="One docker compose stack. Postgres + Redis + Caddy + WireGuard. Optional observability profile (Prometheus / Grafana / Loki)."
        >
          <div className="mt-4 flex flex-wrap gap-1.5 font-mono text-[10px]">
            {["api", "worker", "db", "redis", "caddy", "wg", "grafana", "loki"].map((t) => (
              <span
                key={t}
                className="border-border text-muted-foreground border px-2 py-0.5"
              >
                {t}
              </span>
            ))}
          </div>
        </BentoCard>
        <BentoCard
          n="04.7"
          h="Per-device policy"
          b="Split-tunnel, custom DNS, friendly hostnames, QR onboarding."
        />
        <BentoCard
          n="04.8"
          h="Backup & restore"
          b="Postgres dumps + WG snapshots. Optional age-encryption."
        />
      </div>
    </section>
  )
}

function BentoCard({
  n,
  h,
  b,
  children,
  className,
  accent,
}: {
  n: string
  h: string
  b: string
  children?: React.ReactNode
  className?: string
  accent?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        // On mobile (single column) we only want bottom rules — vertical
        // rules dangling at the right look broken. lg+ uses the grid edges.
        "border-border flex flex-col gap-2 border-b p-6 lg:border-r",
        "last:border-b-0 lg:last:border-r-0",
        accent && "bg-primary/[0.04]",
        className,
      )}
    >
      <div className="zv-eyebrow">{n}</div>
      <h3 className="font-heading mt-2 text-lg font-medium tracking-[-0.01em]">
        {h}
      </h3>
      <p className="text-muted-foreground m-0 max-w-[44ch] text-[13px] leading-relaxed">
        {b}
      </p>
      {children}
    </motion.div>
  )
}

function MiniStat({
  label,
  value,
  unit,
}: {
  label: string
  value: string
  unit?: string
}) {
  return (
    <div className="border-border flex flex-col gap-0.5 border p-2">
      <span className="text-muted-foreground/70 font-mono text-[9px] uppercase">
        {label}
      </span>
      <span className="font-heading text-xl tracking-[-0.02em]">
        {value}
        {unit && (
          <span className="text-muted-foreground ml-1 font-mono text-[10px]">
            {unit}
          </span>
        )}
      </span>
    </div>
  )
}

// ── Preview 2: Topology ──────────────────────────────────────────────

function PreviewTopology() {
  return (
    <section className="grid grid-cols-1 border-b lg:grid-cols-[1.4fr_1fr]">
      <motion.div
        className="bg-card/40 p-4 sm:p-6 lg:p-10"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <MockTopology />
      </motion.div>
      <motion.div
        className="border-border border-t p-6 sm:p-10 lg:border-l lg:border-t-0 lg:p-14"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.3, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
      >
        <Eyebrow num="05">Console · Topology</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[16ch] text-3xl font-medium leading-[1.02] tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          Server. You.
          <br />
          Your devices.
        </h2>
        <p className="text-muted-foreground mt-4 max-w-[42ch] text-sm leading-relaxed sm:mt-5">
          A two-level tree that mirrors how WireGuard actually thinks. Drag
          nodes to rearrange — your layout is persisted per user, so the map
          looks the same on every device, every login.
        </p>
        <div className="mt-5 flex flex-wrap gap-1.5 font-mono text-[10px] sm:mt-6">
          {["SVG · viewBox", "ResizeObserver", "Position-persist · debounced", "ZMQ live rates"].map(
            (t) => (
              <span
                key={t}
                className="border-border text-muted-foreground border px-2 py-1"
              >
                {t}
              </span>
            ),
          )}
        </div>
      </motion.div>
    </section>
  )
}

function MockTopology() {
  return (
    <div className="border-border bg-background relative h-[260px] border sm:h-[320px] lg:h-[360px]">
      <div className="text-muted-foreground/70 absolute left-3 top-3 z-[1] font-mono text-[10px] uppercase">
        Live topology · 4 devices
      </div>
      <div className="text-muted-foreground/70 absolute right-3 top-3 z-[1] inline-flex items-center gap-1.5 font-mono text-[10px]">
        <LiveDot /> live
      </div>
      <svg
        viewBox="0 0 600 360"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full"
      >
        <defs>
          <pattern id="topo-grid-mock" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="600" height="360" fill="url(#topo-grid-mock)" className="text-border" opacity="0.5" />

        {/* edges: server → user, user → devices */}
        <line x1="120" y1="180" x2="290" y2="180" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="310" y1="180" x2="470" y2="80" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="310" y1="180" x2="470" y2="170" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="310" y1="180" x2="470" y2="260" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="310" y1="180" x2="470" y2="340" stroke="currentColor" className="text-border" strokeWidth="1" opacity="0.4" />

        {/* pulses along edges */}
        <motion.circle
          r="3"
          fill="var(--primary)"
          cx={120}
          cy={180}
          animate={{ cx: [120, 290], cy: [180, 180] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
        />
        <motion.circle
          r="2.5"
          fill="var(--chart-1)"
          cx={310}
          cy={180}
          animate={{ cx: [310, 470], cy: [180, 80] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
        />
        <motion.circle
          r="2.5"
          fill="var(--chart-1)"
          cx={310}
          cy={180}
          animate={{ cx: [310, 470], cy: [180, 170] }}
          transition={{ duration: 2.0, repeat: Infinity, ease: "linear", delay: 0.5 }}
        />
        <motion.circle
          r="2.5"
          fill="var(--chart-1)"
          cx={310}
          cy={180}
          animate={{ cx: [310, 470], cy: [180, 260] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear", delay: 1.0 }}
        />

        {/* nodes */}
        <NodeRect x={70} y={155} w={100} h={50} label="vpn-server" sub="hub" tone="primary" />
        <NodeRect x={260} y={155} w={100} h={50} label="you" sub="user" tone="muted" />
        <NodeRect x={440} y={55} w={120} h={50} label="macbook-pro" sub="online" tone="ok" />
        <NodeRect x={440} y={145} w={120} h={50} label="pixel-8" sub="online" tone="ok" />
        <NodeRect x={440} y={235} w={120} h={50} label="ipad" sub="online" tone="ok" />
        <NodeRect x={440} y={315} w={120} h={50} label="nas" sub="offline" tone="off" />
      </svg>
    </div>
  )
}

function NodeRect({
  x,
  y,
  w,
  h,
  label,
  sub,
  tone,
}: {
  x: number
  y: number
  w: number
  h: number
  label: string
  sub: string
  tone: "primary" | "muted" | "ok" | "off"
}) {
  const stroke =
    tone === "primary"
      ? "var(--primary)"
      : tone === "ok"
        ? "var(--status-online, var(--primary))"
        : tone === "off"
          ? "var(--muted-foreground)"
          : "currentColor"
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="var(--background)"
        stroke={stroke}
        strokeWidth="1"
        opacity={tone === "off" ? 0.5 : 1}
      />
      <text
        x={x + 8}
        y={y + 22}
        className="fill-foreground font-mono"
        fontSize="11"
      >
        {label}
      </text>
      <text
        x={x + 8}
        y={y + 38}
        className="fill-muted-foreground font-mono"
        fontSize="9"
      >
        {sub}
      </text>
    </g>
  )
}

// ── Architecture ──────────────────────────────────────────────────────

function Architecture() {
  const layers = [
    { tag: "edge", title: "Caddy", body: "TLS termination · HTTP/3 · automatic certs" },
    { tag: "control", title: "API · axum", body: "Auth, devices, admin, OpenAPI — Rust" },
    { tag: "worker", title: "Worker", body: "WG state · ZMQ publisher · tick-level samples" },
    { tag: "data", title: "Data plane", body: "Postgres 18 · Redis · age-encrypted backups" },
    { tag: "wire", title: "WireGuard / AmneziaWG", body: "Kernel module · zero-config peer rotation" },
  ]
  const stack = [
    "Rust 1.81", "Axum", "sqlx", "Tokio",
    "WireGuard", "AmneziaWG", "ZeroMQ", "MessagePack",
    "Postgres 18", "Redis", "Caddy 2",
    "React 19", "Vite", "TanStack Query", "Zustand", "Tailwind",
  ]
  return (
    <section
      id="architecture"
      className="grid grid-cols-1 border-b lg:grid-cols-[1fr_1.2fr]"
    >
      <div className="border-border border-b p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-14">
        <Eyebrow num="06">Architecture</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[14ch] text-3xl font-medium leading-[1.02] tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          One stack.
          <br />
          Zero leaks.
        </h2>
        <p className="text-muted-foreground mt-4 max-w-[42ch] text-sm leading-relaxed sm:mt-5">
          Browser to backbone in five well-defined layers. Every hop is yours —
          no third-party SaaS in the data path, no telemetry phoning home.
        </p>
        <div className="mt-6 flex flex-wrap gap-1.5 font-mono text-[10px] sm:mt-8">
          {stack.map((s) => (
            <span
              key={s}
              className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 border px-2 py-1 transition-colors"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
      <motion.div
        className="flex flex-col p-6 sm:p-10 lg:p-14"
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, amount: 0.3 }}
        variants={{ initial: {}, animate: { transition: stagger(0.05) } }}
      >
        {layers.map((l, i) => (
          <motion.div
            key={l.tag}
            variants={cardVariants}
            className="border-border grid grid-cols-[64px_1fr] items-baseline gap-3 border-l py-4 pl-4 first:pt-0 last:pb-0 sm:grid-cols-[80px_1fr] sm:gap-4"
          >
            <span className="text-muted-foreground/70 font-mono text-[10px] uppercase tracking-wide">
              {String(i + 1).padStart(2, "0")} · {l.tag}
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-foreground font-mono text-[13px] font-medium">
                {l.title}
              </span>
              <span className="text-muted-foreground text-[12px] leading-relaxed">
                {l.body}
              </span>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}

// ── Preview 3: Device Detail ─────────────────────────────────────────

function PreviewDeviceDetail() {
  return (
    <section className="grid grid-cols-1 border-b lg:grid-cols-[1fr_1.4fr]">
      <motion.div
        className="border-border border-b p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-14"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <Eyebrow num="07">Console · Device detail</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[16ch] text-3xl font-medium leading-[1.02] tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          Configure.
          <br />
          Audit.
          <br />
          Rotate.
        </h2>
        <p className="text-muted-foreground mt-4 max-w-[42ch] text-sm leading-relaxed sm:mt-5">
          Per-device split-tunnel, custom DNS, friendly hostnames, and a
          timeline of every lifecycle event — from creation to revoke. Re-issue
          keys with one click; the old .conf stops working the instant you
          confirm.
        </p>
        <div className="mt-5 flex flex-wrap gap-1.5 font-mono text-[10px] sm:mt-6">
          {["wg-conf · live render", "Audit · per-device", "Re-issue · destructive", "QR scan"].map(
            (t) => (
              <span
                key={t}
                className="border-border text-muted-foreground border px-2 py-1"
              >
                {t}
              </span>
            ),
          )}
        </div>
      </motion.div>
      <motion.div
        className="bg-card/40 p-4 sm:p-6 lg:p-10"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.3, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
      >
        <MockDeviceDetail />
      </motion.div>
    </section>
  )
}

function MockDeviceDetail() {
  return (
    <div className="border-border bg-background flex flex-col gap-3 border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-muted-foreground/70 font-mono text-[9px] uppercase">
            Devices · A8F1B2C0
          </span>
          <span className="font-heading mt-0.5 text-xl tracking-[-0.02em]">
            macbook-pro-arvid
          </span>
        </div>
        <Pill tone="ok">online</Pill>
      </div>
      <div className="grid grid-cols-2 gap-0 border sm:grid-cols-4">
        {[
          { l: "TX · live", v: "182 Mb/s" },
          { l: "RX · live", v: "240 Mb/s" },
          { l: "Total · 24h", v: "8.4 GB" },
          { l: "Handshake", v: "12s ago" },
        ].map((k, i) => (
          <div
            key={k.l}
            className={cn(
              "flex flex-col gap-0.5 p-2.5",
              // 2×2 on mobile, 1×4 on sm+.
              i % 2 === 0 && "border-r sm:border-r",
              i < 2 && "border-b sm:border-b-0",
              i === 2 && "sm:border-r",
            )}
          >
            <span className="text-muted-foreground/70 font-mono text-[9px] uppercase">
              {k.l}
            </span>
            <span className="font-heading text-base tracking-[-0.02em]">
              {k.v}
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 border p-3 font-mono text-[11px]">
          <span className="text-muted-foreground/70 font-mono text-[9px] uppercase">
            Configuration
          </span>
          <Row k="vpn ip" v="10.66.0.4" />
          <Row k="endpoint" v="hub.example.com:51820" />
          <Row k="allowed-ips" v="0.0.0.0/0" />
          <Row k="dns" v="10.66.0.1" />
          <Row k="dns name" v="laptop.vpn.local" />
        </div>
        <div className="flex flex-col gap-1.5 border p-3 font-mono text-[11px]">
          <span className="text-muted-foreground/70 font-mono text-[9px] uppercase">
            Activity · last 5
          </span>
          {[
            { t: "now", d: "device.online", tone: "ok" as const },
            { t: "12m", d: "config.updated", tone: "info" as const },
            { t: "1h", d: "key.rotated", tone: "warn" as const },
            { t: "1d", d: "dns.added", tone: "info" as const },
            { t: "3d", d: "device.created", tone: "neutral" as const },
          ].map((r) => (
            <div key={r.t} className="flex items-baseline gap-2">
              <span className="text-muted-foreground/70 w-8">{r.t}</span>
              <Pill tone={r.tone} dot={false}>
                {r.d}
              </Pill>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground/70 uppercase">{k}</span>
      <span className="text-foreground truncate">{v}</span>
    </div>
  )
}

// ── Deploy ────────────────────────────────────────────────────────────

function Deploy() {
  return (
    <section id="deploy" className="grid grid-cols-1 border-b lg:grid-cols-2">
      <motion.div
        className="border-border border-b p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-14"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <Eyebrow num="08">Deploy</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[14ch] text-3xl font-medium leading-[1.02] tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          Boring.
          <br />
          Repeatable.
          <br />
          Fast.
        </h2>
        <p className="text-muted-foreground mt-4 max-w-[44ch] text-sm leading-relaxed sm:mt-5">
          One compose file with optional profiles. Bring your own Linux box,
          or scale across regions. The runbook walks you through setup,
          restore drills, and the security checklist.
        </p>
        <div className="mt-6 flex flex-col gap-3 font-mono text-xs sm:mt-8">
          {[
            ["00:00", "git clone & cp .env.example"],
            ["00:02", "docker compose --profile wg up -d"],
            ["00:08", "First user → admin · TOTP setup"],
            ["00:11", "Add device · scan QR · connected"],
            ["00:15", "Live topology · timeline · audit"],
          ].map(([t, b]) => (
            <div key={t} className="flex items-center gap-3">
              <span className="text-muted-foreground/60 w-12 shrink-0">{t}</span>
              <span>{b}</span>
            </div>
          ))}
        </div>
      </motion.div>
      <motion.div
        className="overflow-x-auto p-6 sm:p-10 lg:p-14"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.3, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
      >
        <CodeBlock>{`# docker-compose.yml — build from source
services:
  api:     { build: ./crates/zerovpn-api,    ports: ["443"] }
  worker:  { build: ./crates/zerovpn-worker, network_mode: host }
  db:      { image: postgres:18-alpine                          }
  redis:   { image: redis:8-alpine                              }
  caddy:   { image: caddy:2.11-alpine                           }
  wg:      { image: linuxserver/wireguard, profiles: ["wg"]     }

# optional profile: prometheus + grafana + loki + promtail
# optional profile: backup container w/ age encryption`}</CodeBlock>
      </motion.div>
    </section>
  )
}

// ── Security ──────────────────────────────────────────────────────────

function Security() {
  const items = [
    {
      n: "09.1",
      h: "Argon2id at rest",
      b: "Password hashes with sane work factors. Reseeded when the cost lands above policy.",
    },
    {
      n: "09.2",
      h: "KEK · AES-256-GCM",
      b: "Server-stored secrets (TOTP, optional WireGuard keys) encrypted under a KEK. Plaintext never in the DB.",
    },
    {
      n: "09.3",
      h: "TOTP + recovery",
      b: "RFC 6238 with configurable skew. Hashed recovery codes; one-use, revealed once.",
    },
    {
      n: "09.4",
      h: "Brute-force shield",
      b: "10/min/IP rate-limit, /24 prefix tracking, Failed Logins admin board.",
    },
    {
      n: "09.5",
      h: "Session integrity",
      b: "Every request re-checks the password-changed watermark. Rotate a password — every session dies.",
    },
    {
      n: "09.6",
      h: "Audit · 180 days",
      b: "Every admin action and key rotation logged. Exportable as CSV.",
    },
  ]
  return (
    <section id="security" className="border-b">
      <div className="border-border border-b px-5 py-10 sm:px-6 sm:py-12">
        <Eyebrow num="09">Security posture</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[20ch] text-3xl font-medium tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          Quiet by default. Loud when it matters.
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it, i, all) => (
          <motion.div
            key={it.n}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.22, delay: (i % 3) * 0.04, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "border-border flex min-h-[160px] flex-col gap-2 p-6",
              (i + 1) % 2 !== 0 && "border-r sm:border-r",
              (i + 1) % 3 !== 0 && "lg:border-r",
              i < all.length - 1 && "border-b lg:border-b",
              i >= all.length - 3 && "lg:border-b-0",
            )}
          >
            <div className="zv-eyebrow">{it.n}</div>
            <h3 className="font-heading mt-1 text-base font-medium tracking-[-0.01em]">
              {it.h}
            </h3>
            <p className="text-muted-foreground m-0 text-[13px] leading-relaxed">
              {it.b}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ── Compare ───────────────────────────────────────────────────────────

function Compare() {
  const cols: {
    label: string
    sub: string
    rows: { ok?: boolean; label: string }[]
    accent?: boolean
  }[] = [
    {
      label: "SaaS VPN",
      sub: "the easy way",
      rows: [
        { ok: true, label: "Zero ops" },
        { ok: false, label: "Pays in $ + trust" },
        { ok: false, label: "Closed black-box" },
        { ok: false, label: "Logs you can't audit" },
        { ok: false, label: "Vendor lock-in" },
      ],
    },
    {
      label: "Manual WireGuard",
      sub: "the hard way",
      rows: [
        { ok: true, label: "Total control" },
        { ok: false, label: "Hand-roll keys + IPs" },
        { ok: false, label: "No live telemetry" },
        { ok: false, label: "No admin surface" },
        { ok: false, label: "No backup story" },
      ],
    },
    {
      label: "ZeroVPN",
      sub: "the boring way",
      accent: true,
      rows: [
        { ok: true, label: "15-min compose deploy" },
        { ok: true, label: "Sub-second live telemetry" },
        { ok: true, label: "Admin · audit · TOTP · backup" },
        { ok: true, label: "Open source · MIT" },
        { ok: true, label: "Your data, your hardware" },
      ],
    },
  ]
  return (
    <section className="border-b">
      <div className="border-border border-b px-5 py-10 sm:px-6 sm:py-12">
        <Eyebrow num="10">Why ZeroVPN</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[14ch] text-3xl font-medium tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          Pick your trade-off.
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3">
        {cols.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.26, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "border-border flex flex-col gap-3 p-6 sm:p-8",
              i < cols.length - 1 && "border-b md:border-b-0 md:border-r",
              c.accent && "bg-primary/[0.06]",
            )}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-foreground font-mono text-[13px] font-medium">
                {c.label}
              </span>
              <span className="text-muted-foreground/70 font-mono text-[10px] uppercase">
                {c.sub}
              </span>
            </div>
            <ul className="mt-2 flex flex-col gap-2 font-mono text-[12px]">
              {c.rows.map((r) => (
                <li
                  key={r.label}
                  className={cn(
                    "flex items-baseline gap-2",
                    r.ok ? "text-foreground" : "text-muted-foreground/60",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block w-4 shrink-0",
                      r.ok ? "text-primary" : "text-muted-foreground/40",
                    )}
                  >
                    {r.ok ? "✓" : "—"}
                  </span>
                  <span className={r.ok ? undefined : "line-through"}>
                    {r.label}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ── Roadmap teaser ───────────────────────────────────────────────────

function Roadmap() {
  const shipped = [
    "WireGuard + AmneziaWG provisioning",
    "Tick-level telemetry · 180-day audit",
    "TOTP + recovery codes",
    "Live topology · drag-to-rearrange · per-user persist",
    "Admin: users · failed logins · maintenance mode",
    "Backup with optional age encryption",
  ]
  const next = [
    "Multi-region hubs · automatic failover",
    "Webhooks: device.online · key.rotated",
    "Per-user bandwidth quotas + alerts",
    "Public OpenAPI · stable v1",
    "Mobile companion app · iOS · Android",
    "SSO · OIDC / SAML",
  ]
  return (
    <section className="border-b">
      <div className="border-border border-b px-5 py-10 sm:px-6 sm:py-12">
        <Eyebrow num="11">Roadmap</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[18ch] text-3xl font-medium tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          Shipped. Shipping. Sketched.
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        <motion.div
          className="border-border border-b p-6 sm:p-8 md:border-b-0 md:border-r lg:p-12"
          initial={{ opacity: 0, x: -6 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="text-foreground inline-flex items-baseline gap-2 font-mono text-[11px] uppercase">
            <span className="text-primary">✓</span> Shipped
          </div>
          <ul className="mt-4 flex flex-col gap-2 font-mono text-[13px]">
            {shipped.map((s) => (
              <li key={s} className="flex items-baseline gap-3">
                <span className="text-primary">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </motion.div>
        <motion.div
          className="p-6 sm:p-8 lg:p-12"
          initial={{ opacity: 0, x: 6 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.3, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="text-foreground inline-flex items-baseline gap-2 font-mono text-[11px] uppercase">
            <span className="text-muted-foreground/70">○</span> Next
          </div>
          <ul className="mt-4 flex flex-col gap-2 font-mono text-[13px]">
            {next.map((n) => (
              <li
                key={n}
                className="text-muted-foreground flex items-baseline gap-3"
              >
                <span className="text-muted-foreground/60">○</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  )
}

// ── FAQ ───────────────────────────────────────────────────────────────

function FAQ() {
  const faqs = [
    {
      q: "Do you keep traffic logs?",
      a: "No. ZeroVPN never inspects, mirrors, or stores the contents of your traffic. The worker collects WireGuard byte counters (per peer, per tick) so you see live rates — that's it. Nothing leaves your machine.",
    },
    {
      q: "Do I need the WireGuard kernel module?",
      a: "Yes for production performance. The docker-compose wg profile loads it on the host. Userspace wireguard-go works as a fallback for development but is slower under load.",
    },
    {
      q: "Can I run multiple hubs / regions?",
      a: "Yes. The Servers admin surface manages keypairs + endpoints per hub. Multi-region failover with automatic re-allocation is on the roadmap.",
    },
    {
      q: "How does backup work?",
      a: "An optional compose profile dumps Postgres + WireGuard configs on a cron. The runbook covers the age-encryption layer and the restore drill. Verifiable end-to-end on every fresh box.",
    },
    {
      q: "Can I bring my own auth (SSO / OIDC)?",
      a: "Not yet — built-in email + password + TOTP today. OIDC and SAML are on the next milestone. You can already script user creation through the admin endpoints.",
    },
    {
      q: "What's the license?",
      a: "MIT. Use it, fork it, sell what you build on top of it. The only thing we ask is that you don't pretend you wrote the bits we wrote.",
    },
  ]
  return (
    <section id="faq" className="border-b">
      <div className="border-border border-b px-5 py-10 sm:px-6 sm:py-12">
        <Eyebrow num="12">FAQ</Eyebrow>
        <h2 className="font-heading mt-3 max-w-[16ch] text-3xl font-medium tracking-[-0.025em] sm:text-4xl lg:text-5xl">
          Honest answers.
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        {faqs.map((f, i, all) => (
          <motion.div
            key={f.q}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.22, delay: (i % 2) * 0.05, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "border-border flex flex-col gap-3 p-6 sm:p-8",
              i % 2 === 0 && "md:border-r",
              i < all.length - 2 && "border-b",
              i === all.length - 2 && "border-b md:border-b-0",
            )}
          >
            <h3 className="font-heading text-lg font-medium tracking-[-0.01em]">
              {f.q}
            </h3>
            <p className="text-muted-foreground m-0 max-w-[55ch] text-[13px] leading-relaxed">
              {f.a}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ── CTA ───────────────────────────────────────────────────────────────

function CTA() {
  return (
    <motion.section
      className="border-b px-5 py-16 text-center sm:px-6 sm:py-24"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <Eyebrow num="13" className="justify-center">
        Ready
      </Eyebrow>
      <h2 className="font-heading mt-4 text-4xl font-medium leading-[0.95] tracking-[-0.03em] sm:text-5xl lg:text-7xl">
        Stop renting
        <br />
        your privacy.
      </h2>
      <p className="text-muted-foreground mx-auto mt-5 max-w-[56ch] text-sm leading-relaxed sm:mt-6 sm:text-base">
        Self-host in fifteen minutes. Open source, MIT-licensed. No accounts
        upstream, no telemetry phoning home, no ceremony.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:mt-8">
        <Button asChild size="lg">
          <Link to="/register">Get started</Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link to="/login">See live demo</Link>
        </Button>
      </div>
      {/* Installer one-liner. Scrolls horizontally on narrow screens
          instead of forcing a layout shift / wrap. */}
      <div className="text-muted-foreground mx-auto mt-8 flex max-w-full items-center gap-2 overflow-x-auto px-1 font-mono text-[11px] sm:mt-10 sm:justify-center">
        <span className="shrink-0 opacity-60">$</span>
        <span className="text-foreground whitespace-nowrap">
          git clone https://github.com/zerovpn/zerovpn &amp;&amp; cd zerovpn &amp;&amp; docker compose --profile wg up -d
        </span>
      </div>
    </motion.section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────

function LandingFooter() {
  return (
    <footer className="text-muted-foreground grid grid-cols-2 gap-6 p-6 font-mono text-xs sm:grid-cols-4 sm:gap-8 sm:p-8">
      <div className="flex flex-col gap-2">
        <Wordmark size={11} />
        <span>MIT · {new Date().getFullYear()}</span>
        <span className="text-muted-foreground/60">
          Built with Rust + React.
        </span>
        <a
          href="https://github.com/zerovpn/zerovpn"
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground mt-1 transition-colors"
        >
          GitHub ↗
        </a>
      </div>
      <div className="flex flex-col gap-1">
        <b className="text-foreground font-medium">PRODUCT</b>
        <a href="#features" className="hover:text-foreground transition-colors">
          Features
        </a>
        <a href="#architecture" className="hover:text-foreground transition-colors">
          Architecture
        </a>
        <a href="#security" className="hover:text-foreground transition-colors">
          Security
        </a>
        <a href="#faq" className="hover:text-foreground transition-colors">
          FAQ
        </a>
      </div>
      <div className="flex flex-col gap-1">
        <b className="text-foreground font-medium">DOCS</b>
        <a href="#deploy" className="hover:text-foreground transition-colors">
          Install
        </a>
        <a
          href="https://github.com/zerovpn/zerovpn/blob/main/docs/runbook.md"
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Runbook ↗
        </a>
        <a
          href="https://github.com/zerovpn/zerovpn/blob/main/docs/architecture.md"
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Architecture ↗
        </a>
        <a
          href="/openapi.json"
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground transition-colors"
        >
          OpenAPI ↗
        </a>
      </div>
      <div className="flex flex-col gap-1">
        <b className="text-foreground font-medium">ACCOUNT</b>
        <Link to="/login" className="hover:text-foreground transition-colors">
          Sign in
        </Link>
        <Link to="/register" className="hover:text-foreground transition-colors">
          Register
        </Link>
        <Link to="/forgot-password" className="hover:text-foreground transition-colors">
          Recovery
        </Link>
      </div>
    </footer>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────

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

// Synthetic data for the inline product previews. Deterministic — no
// RNG so the SSR / first render matches subsequent client renders.
function sineWave(n: number, base: number, amp: number, phase = 0): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 4 + phase
    out.push(Math.max(0, base + amp * Math.sin(t) + (amp * 0.4) * Math.cos(t * 2.3 + phase)))
  }
  return out
}

function pathLine(data: number[], w: number, h: number): string {
  if (data.length === 0) return ""
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  return data
    .map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 2) - 1
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

function pathArea(data: number[], w: number, h: number): string {
  return `${pathLine(data, w, h)} L${w},${h} L0,${h} Z`
}
