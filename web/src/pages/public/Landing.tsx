import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { ping } from "@/lib/api"

export function LandingPage() {
  const pingQuery = useQuery({
    queryKey: ["ping"],
    queryFn: ping,
    refetchInterval: 5000,
  })

  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col">
      <header className="flex items-center justify-between p-6">
        <h1 className="text-lg font-semibold">ZeroVPN</h1>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/register">Create account</Link>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="max-w-xl space-y-6 text-center"
        >
          <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Self-hosted WireGuard, <span className="text-primary">made simple</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            ZeroVPN is a privacy-first, no-logs WireGuard manager with AmneziaWG
            obfuscation, real-time monitoring, and a clean web UI.
          </p>

          <ApiStatusPill state={pingQuery.status} ts={pingQuery.data?.ts_ms} />

          <div className="flex justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/register">Get started</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            <Link to="/forgot-password" className="underline">
              Forgot your password?
            </Link>
          </p>
        </motion.section>
      </main>

      <footer className="text-muted-foreground p-6 text-center text-xs">
        ZeroVPN · {new Date().getFullYear()}
      </footer>
    </div>
  )
}

function ApiStatusPill({ state, ts }: { state: string; ts?: number }) {
  const color =
    state === "success"
      ? "bg-green-500/15 text-green-700 dark:text-green-400"
      : state === "error"
        ? "bg-red-500/15 text-red-700 dark:text-red-400"
        : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
  const label =
    state === "success"
      ? `API online${ts ? " · " + new Date(ts).toLocaleTimeString() : ""}`
      : state === "error"
        ? "API unreachable"
        : "Pinging API…"
  return (
    <div className="inline-flex items-center justify-center">
      <motion.span
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        className={`rounded-full px-3 py-1 text-xs font-medium ${color}`}
      >
        {label}
      </motion.span>
    </div>
  )
}
