/**
 * Single source of truth for animation timings, easings, and variants.
 *
 * Rules of thumb (from the redesign plan):
 *   • duration ≤ 250 ms anywhere
 *   • exits ≈ 70 % of entry duration
 *   • no bouncy springs on layout — only on numeric tickers
 *   • translate distances are 4–8 px, never 20+
 *   • prefers-reduced-motion is honored everywhere via `useReducedMotion`
 */
import { useSyncExternalStore } from "react"
import type { Transition, Variants } from "motion/react"
import { useReducedMotion as useOsReducedMotion } from "motion/react"

// User's saved "reduced motion" preference, applied app-wide via a
// module-level setter — mirrors `setUnitsPref` / `setDateTimePrefs`. The
// Toaster preferences applier (components/ui/sonner.tsx) calls
// `setReducedMotionPref` once `/me/preferences` resolves. When true, motion
// is suppressed even if the OS isn't asking for it; when false we still
// honor the OS `prefers-reduced-motion` media query, so the gate is the
// OR of the two sources.
let prefReducedMotion = false
const reducedMotionListeners = new Set<() => void>()

export function setReducedMotionPref(v: boolean) {
  if (v === prefReducedMotion) return
  prefReducedMotion = v
  for (const fn of reducedMotionListeners) fn()
}

function subscribeReducedMotion(cb: () => void) {
  reducedMotionListeners.add(cb)
  return () => reducedMotionListeners.delete(cb)
}

function reducedMotionSnapshot() {
  return prefReducedMotion
}

/** Reduced-motion gate used everywhere we animate. True when *either* the
 *  OS `prefers-reduced-motion` query is set *or* the user enabled
 *  Settings → Reduced motion. Replaces the bare `motion/react` re-export
 *  (which only saw the OS query and ignored the saved preference). */
export function useReducedMotion(): boolean {
  const os = useOsReducedMotion()
  const pref = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    reducedMotionSnapshot,
  )
  return Boolean(os) || pref
}

export const TIMING = {
  enter: 0.28,
  exit: 0.22,
  micro: 0.1,
  /** Initial delay before route-level transitions start. Gives the
   *  outgoing page a beat to clear before the incoming one slides in,
   *  so the navigation reads as a deliberate transition rather than a
   *  flicker. Kept short enough that snappy users still feel it's fast. */
  routeDelay: 0.08,
  /** Use for numeric tickers via motion useSpring. Slight underdamping. */
  stat: { type: "spring" as const, stiffness: 150, damping: 25 },
} as const

export const EASING = {
  /** Linear/Vercel decelerate-on-arrive. Use for entries. */
  out: [0.16, 1, 0.3, 1] as const,
  /** Snappy accelerate-on-leave. Use for exits. */
  in: [0.7, 0, 0.84, 0] as const,
  inOut: [0.83, 0, 0.17, 1] as const,
}

const enter: Transition = { duration: TIMING.enter, ease: EASING.out }
const exit: Transition = { duration: TIMING.exit, ease: EASING.in }

/** Cards mounted on a page after data resolves. Stagger via `delay`. */
export const cardVariants: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: enter },
  exit: { opacity: 0, y: -2, transition: exit },
}

/** Stagger N children at 40 ms apart inside the parent's `animate`. */
export const stagger = (delay = 0.04): Transition => ({
  staggerChildren: delay,
  delayChildren: 0.02,
})
