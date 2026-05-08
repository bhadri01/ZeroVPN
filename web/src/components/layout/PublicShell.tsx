import { AnimatePresence, motion } from "motion/react"
import { Suspense } from "react"
import { Outlet, useLocation } from "react-router"

import { Skeleton } from "@/components/ui/skeleton"
import { pageVariants, useReducedMotion } from "@/lib/motion"

export function PublicShell() {
  const location = useLocation()
  const reduceMotion = useReducedMotion()

  return (
    <div className="bg-background text-foreground relative min-h-svh">
      {/* Subtle dotted radial backdrop — barely visible, signals "premium" */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_-20%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_55%)]"
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={reduceMotion ? false : "initial"}
          animate="animate"
          exit="exit"
          variants={reduceMotion ? undefined : pageVariants}
          className="relative z-10"
        >
          <Suspense
            fallback={
              <div className="flex min-h-svh items-center justify-center p-6">
                <Skeleton className="h-64 w-full max-w-sm" />
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
