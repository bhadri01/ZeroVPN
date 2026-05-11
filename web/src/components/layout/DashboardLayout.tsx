import { AnimatePresence, motion } from "motion/react"
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
import { pageVariants, useReducedMotion } from "@/lib/motion"

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
  const reduceMotion = useReducedMotion()
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
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={reduceMotion ? false : "initial"}
                animate="animate"
                exit="exit"
                variants={reduceMotion ? undefined : pageVariants}
                className="flex flex-col gap-6 px-6 py-6"
              >
                <Suspense fallback={<RoutePending />}>
                  <Outlet />
                </Suspense>
              </motion.div>
            </AnimatePresence>
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
