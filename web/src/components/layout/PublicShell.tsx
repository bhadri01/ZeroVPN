import { AnimatePresence, motion } from "motion/react"
import { Suspense } from "react"
import { Outlet, useLocation } from "react-router"

import { Skeleton } from "@/components/ui/skeleton"
import { pageVariants, useReducedMotion } from "@/lib/motion"

/** Swiss public shell. Flat paper background — auth & landing pages
 * supply their own grid texture via the .zv-grid-bg utility where they
 * want it (auth side panel, landing hero). No global radial halo. */
export function PublicShell() {
  const location = useLocation()
  const reduceMotion = useReducedMotion()

  return (
    <div className="bg-background text-foreground relative min-h-svh">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={reduceMotion ? false : "initial"}
          animate="animate"
          exit="exit"
          variants={reduceMotion ? undefined : pageVariants}
          className="relative"
        >
          <Suspense
            fallback={
              <div className="flex min-h-svh items-center justify-center p-6">
                <Skeleton className="h-64 w-full max-w-sm rounded-none" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
