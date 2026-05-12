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
import type { Transition, Variants } from "motion/react"
export { useReducedMotion } from "motion/react"

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

/** Page transitions inside a router outlet. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: enter },
  exit: { opacity: 0, y: -2, transition: exit },
}

/** Cards mounted on a page after data resolves. Stagger via `delay`. */
export const cardVariants: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: enter },
  exit: { opacity: 0, y: -2, transition: exit },
}

/** Modal / Dialog / AlertDialog content. */
export const modalVariants: Variants = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1, transition: enter },
  exit: { opacity: 0, scale: 0.98, transition: exit },
}

/** A row in a list/table: enters on create, collapses on delete. */
export const listVariants: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: enter },
  exit: {
    opacity: 0,
    x: -4,
    height: 0,
    marginTop: 0,
    marginBottom: 0,
    transition: exit,
  },
}

/** Compact pop for command palette / popover. */
export const popVariants: Variants = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1, transition: enter },
  exit: { opacity: 0, scale: 0.96, transition: exit },
}

/** Stagger N children at 40 ms apart inside the parent's `animate`. */
export const stagger = (delay = 0.04): Transition => ({
  staggerChildren: delay,
  delayChildren: 0.02,
})
