import { IconSearch } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Link, useMatches } from "react-router"

import { UserMenu } from "@/components/layout/UserMenu"
import { ModeToggle } from "@/components/mode-toggle"
import { Kbd, LiveDot } from "@/components/swiss"
import { useBreadcrumbStore } from "@/stores/breadcrumb"

type Crumb = { to?: string; label: string }
type CrumbHandle = {
  breadcrumb?: string | ((params: Record<string, string>) => string)
}

function isCrumbHandle(value: unknown): value is CrumbHandle {
  return typeof value === "object" && value !== null && "breadcrumb" in value
}

function useBreadcrumbs(): Crumb[] {
  const matches = useMatches()
  const overrides = useBreadcrumbStore((s) => s.overrides)
  const crumbs: Crumb[] = []
  for (const m of matches) {
    if (!isCrumbHandle(m.handle)) continue
    const b = m.handle.breadcrumb
    if (b == null) continue
    const fallback =
      typeof b === "function"
        ? b((m.params ?? {}) as Record<string, string>)
        : b
    const label = overrides[m.id] ?? fallback
    if (!label) continue
    crumbs.push({ to: m.pathname, label })
  }
  return crumbs
}

export function TopBar({
  onOpenCommand,
}: {
  onOpenCommand?: () => void
}) {
  const crumbs = useBreadcrumbs()
  return (
    <header className="bg-background sticky top-0 z-30 flex h-12 items-center gap-4 border-b px-4">
      <nav
        aria-label="breadcrumb"
        className="text-muted-foreground flex min-w-0 items-center gap-2 font-mono text-[12px]"
      >
        {crumbs.length === 0 ? (
          <span className="text-foreground truncate font-medium">ZeroVPN</span>
        ) : (
          crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <span key={`${c.to}-${i}`} className="flex items-center gap-2">
                {i > 0 && (
                  <span className="text-muted-foreground/50 shrink-0">/</span>
                )}
                {last || !c.to ? (
                  <span className="text-foreground truncate font-medium">
                    {c.label}
                  </span>
                ) : (
                  <Link
                    to={c.to}
                    className="hover:text-foreground truncate transition-colors"
                  >
                    {c.label}
                  </Link>
                )}
              </span>
            )
          })
        )}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <SearchTrigger onClick={onOpenCommand} />
        <LivePill />
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  )
}

function SearchTrigger({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground border-border bg-background hover:border-foreground focus-visible:ring-ring focus-visible:border-foreground flex h-7 w-44 items-center gap-2 border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 md:w-64"
      aria-label="Open search"
    >
      <IconSearch className="size-3.5 shrink-0" />
      <span className="flex-1 text-left">Search · jump…</span>
      <Kbd className="hidden md:inline-flex">⌘K</Kbd>
    </button>
  )
}

/** Live status pill — pulsing dot + UTC clock. Matches the design's
 * topbar live-pill exactly. Updates every second on a local interval. */
function LivePill() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = (n: number) => String(n).padStart(2, "0")
  const time = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())} UTC`
  return (
    <span className="border-border text-muted-foreground hidden h-7 items-center gap-1.5 border px-2 font-mono text-[11px] md:inline-flex">
      <LiveDot />
      <span>connected</span>
      <span className="text-muted-foreground/70">· {time}</span>
    </span>
  )
}
