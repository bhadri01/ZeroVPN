import { IconChevronRight, IconCommand } from "@tabler/icons-react"
import { Link, useMatches } from "react-router"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

type Crumb = { to?: string; label: string }
type CrumbHandle = {
  breadcrumb?: string | ((params: Record<string, string>) => string)
}

function isCrumbHandle(value: unknown): value is CrumbHandle {
  return typeof value === "object" && value !== null && "breadcrumb" in value
}

function useBreadcrumbs(): Crumb[] {
  const matches = useMatches()
  const crumbs: Crumb[] = []
  for (const m of matches) {
    if (!isCrumbHandle(m.handle)) continue
    const b = m.handle.breadcrumb
    if (b == null) continue
    const label =
      typeof b === "function"
        ? b((m.params ?? {}) as Record<string, string>)
        : b
    if (!label) continue
    crumbs.push({
      to: m.pathname,
      label,
    })
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
    <header className="bg-background/80 sticky top-0 z-30 flex h-12 items-center gap-3 border-b px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <nav
        aria-label="breadcrumb"
        className="text-muted-foreground flex items-center text-sm"
      >
        {crumbs.length === 0 ? (
          <span className="font-medium text-foreground">ZeroVPN</span>
        ) : (
          crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <span key={`${c.to}-${i}`} className="flex items-center">
                {i > 0 && (
                  <IconChevronRight className="text-muted-foreground/50 mx-1 size-3" />
                )}
                {last || !c.to ? (
                  <span className="text-foreground font-medium">
                    {c.label}
                  </span>
                ) : (
                  <Link to={c.to} className="hover:text-foreground transition-colors">
                    {c.label}
                  </Link>
                )}
              </span>
            )
          })
        )}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {onOpenCommand && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenCommand}
            className="text-muted-foreground hidden gap-2 md:inline-flex"
            aria-label="Open command palette"
          >
            <IconCommand className="size-3.5" />
            <span>Search…</span>
            <kbd className="bg-muted text-muted-foreground pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium">
              ⌘K
            </kbd>
          </Button>
        )}
      </div>
    </header>
  )
}
