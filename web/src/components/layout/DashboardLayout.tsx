import { motion } from "motion/react"
import { Suspense, useState } from "react"
import {
  Outlet,
  ScrollRestoration,
  useLocation,
} from "react-router"

import { CommandPalette } from "@/components/CommandPalette"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { LiveStatsProvider } from "@/components/layout/LiveStatsProvider"
import { TopBar } from "@/components/layout/TopBar"
import { MaintenanceBanner } from "@/components/MaintenanceBanner"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useReducedMotion } from "@/lib/motion"

/**
 * Reads the persisted sidebar collapse state from cookie. The shadcn
 * sidebar block expects an initial `defaultOpen` so the first paint matches
 * what was last selected — without this the bar flashes from open → closed.
 */
function readSidebarCookie(): boolean {
  if (typeof document === "undefined") return true
  const m = document.cookie.match(/(?:^|;\s*)sidebar_state=([^;]+)/)
  if (!m) return true
  return m[1] === "true"
}

export function DashboardLayout() {
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const sidebarOpen = readSidebarCookie()

  return (
    <TooltipProvider delayDuration={250}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <LiveStatsProvider />
        <AppSidebar />
        <SidebarInset className="bg-background">
          <TopBar onOpenCommand={() => setPaletteOpen(true)} />
          <MaintenanceBanner />
          <ScrollRestoration />
          <main className="relative flex-1">
            {/* Route-level entry. Keyed on pathname so each navigation
                remounts (and re-fires the entry animation). Plain mount
                animation — no AnimatePresence, no `mode="wait"` — which
                was previously interacting badly with React Suspense for
                lazy-loaded routes (the page would stay at initial:0
                opacity and look "empty" until a hard refresh). The inner
                PageStagger handles the per-section cascade. */}
            <PageMount key={location.pathname}>
              <Suspense fallback={<RoutePending />}>
                <Outlet />
              </Suspense>
            </PageMount>
          </main>
        </SidebarInset>
        <CommandPalette
          openOverride={paletteOpen}
          setOpenOverride={setPaletteOpen}
        />
      </SidebarProvider>
    </TooltipProvider>
  )
}

function PageMount({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  if (reduce) {
    return <div className="flex flex-col gap-6 px-6 py-6">{children}</div>
  }
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-6 px-6 py-6"
    >
      {children}
    </motion.div>
  )
}

function RoutePending() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48 rounded-none" />
      <div className="zv-kpi-strip">
        {[0, 1, 2, 3].map((i) => (
          <div className="zv-kpi" key={i}>
            <Skeleton className="h-3 w-20 rounded-none" />
            <Skeleton className="h-7 w-24 rounded-none" />
            <Skeleton className="h-[26px] w-full rounded-none" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64 rounded-none" />
    </div>
  )
}
