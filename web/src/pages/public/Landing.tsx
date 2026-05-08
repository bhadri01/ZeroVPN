import { useQuery } from "@tanstack/react-query"
import {
  IconArrowRight,
  IconLock,
  IconShield,
  IconWaveSine,
} from "@tabler/icons-react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { ping } from "@/lib/api"

export function LandingPage() {
  const pingQ = useQuery({
    queryKey: ["ping"],
    queryFn: ping,
    refetchInterval: 5000,
  })

  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
            <IconShield className="size-4" />
          </span>
          ZeroVPN
        </Link>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/register">
              Create account
              <IconArrowRight />
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <section className="mx-auto max-w-2xl space-y-8 text-center">
          <ApiStatus
            state={pingQ.status}
            ts={pingQ.data?.ts_ms as number | undefined}
          />
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            Your own WireGuard,
            <br />
            <span className="text-muted-foreground">simply yours.</span>
          </h1>
          <p className="text-muted-foreground mx-auto max-w-md text-base sm:text-lg">
            A privacy-first, no-logs WireGuard manager with AmneziaWG
            obfuscation, real-time monitoring, and a single-binary deploy.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button asChild size="lg">
              <Link to="/register">
                Get started
                <IconArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        </section>

        <section className="text-muted-foreground mx-auto mt-16 grid max-w-3xl grid-cols-1 gap-6 text-sm sm:grid-cols-3">
          <Feature icon={IconShield}>
            <strong className="text-foreground">No logs.</strong> No DNS
            queries, no traffic content, /24 IP prefixes only.
          </Feature>
          <Feature icon={IconWaveSine}>
            <strong className="text-foreground">AmneziaWG.</strong>{" "}
            Per-peer randomised obfuscation params for restrictive networks.
          </Feature>
          <Feature icon={IconLock}>
            <strong className="text-foreground">Self-hosted.</strong>{" "}
            <code className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">
              docker compose up -d
            </code>
            .
          </Feature>
        </section>
      </main>

      <footer className="text-muted-foreground mx-auto w-full max-w-6xl px-6 py-6 text-center text-xs">
        ZeroVPN · {new Date().getFullYear()} ·{" "}
        <Link to="/forgot-password" className="hover:text-foreground">
          Forgot password?
        </Link>
      </footer>
    </div>
  )
}

function ApiStatus({ state, ts }: { state: string; ts?: number }) {
  const tone =
    state === "success"
      ? "bg-status-online"
      : state === "error"
        ? "bg-status-revoked"
        : "bg-status-degraded"
  const label =
    state === "success"
      ? `Live${ts ? " · " + new Date(ts).toLocaleTimeString() : ""}`
      : state === "error"
        ? "API unreachable"
        : "Pinging…"
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium">
      <span className={`${tone} size-1.5 animate-pulse rounded-full`} />
      {label}
    </span>
  )
}

function Feature({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2 text-left">
      <span className="bg-muted text-muted-foreground flex size-7 items-center justify-center rounded-md">
        <Icon className="size-4" />
      </span>
      <p className="leading-relaxed">{children}</p>
    </div>
  )
}
