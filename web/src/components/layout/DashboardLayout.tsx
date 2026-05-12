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
import { RouteSkeleton } from "@/components/layout/RouteSkeletons"
import { TopBar } from "@/components/layout/TopBar"
import { MaintenanceBanner } from "@/components/MaintenanceBanner"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { EASING, TIMING, useReducedMotion } from "@/lib/motion"

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
                PageStagger handles the per-section cascade.

                Suspense fallback is path-aware via <RouteSkeleton> so
                each page's loading state mirrors its actual layout — no
                jump when the lazy chunk resolves. */}
            <PageMount key={location.pathname}>
              <Suspense fallback={<RouteSkeleton pathname={location.pathname} />}>
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
  // Route-level entry. Slightly longer than a typical micro-interaction
  // so navigation reads as a deliberate transition; the leading delay
  // (TIMING.routeDelay) gives the outgoing page a beat to clear before
  // the incoming one slides in. A small `y` offset keeps it visible
  // without the chart inside ever appearing to "drop" — that
  // translation is invisibly absorbed by the surrounding chrome.
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: TIMING.enter,
        ease: EASING.out,
        delay: TIMING.routeDelay,
      }}
      className="flex flex-col gap-6 px-6 py-6"
    >
      {children}
    </motion.div>
  )
}
