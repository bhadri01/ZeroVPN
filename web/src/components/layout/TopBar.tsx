import { IconChevronRight, IconSearch } from "@tabler/icons-react"
import { Link, useMatches } from "react-router"

import { ModeToggle } from "@/components/mode-toggle"
import { UserMenu } from "@/components/layout/UserMenu"
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
    // Page-set override wins over the static handle label, e.g. the
    // actual device name instead of "Device".
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
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-3 backdrop-blur md:px-4">
      <nav
        aria-label="breadcrumb"
        className="text-muted-foreground flex min-w-0 items-center text-sm"
      >
        {crumbs.length === 0 ? (
          <span className="text-foreground truncate font-medium">ZeroVPN</span>
        ) : (
          crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <span key={`${c.to}-${i}`} className="flex items-center">
                {i > 0 && (
                  <IconChevronRight className="text-muted-foreground/50 mx-1 size-3 shrink-0" />
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

      <div className="ml-auto flex items-center gap-1.5">
        <SearchTrigger onClick={onOpenCommand} />
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  )
}

/**
 * Input-styled trigger for the command palette. Looks like a search bar
 * but is a button — clicking it (or pressing Cmd+K anywhere) opens the
 * cmdk palette which IS the search input.
 */
function SearchTrigger({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground border-input bg-background hover:bg-muted/50 hover:border-border focus-visible:ring-ring/40 focus-visible:border-ring flex h-8 w-44 items-center gap-2 rounded-md border px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 md:w-64"
      aria-label="Open search"
    >
      <IconSearch className="size-3.5 shrink-0" />
      <span className="flex-1 text-left text-xs">Search…</span>
      <kbd className="bg-muted text-muted-foreground pointer-events-none hidden h-5 select-none items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium md:inline-flex">
        ⌘K
      </kbd>
    </button>
  )
}
