import { AnimatePresence, motion, type Variants } from "motion/react"
import { Children, isValidElement, type ReactNode } from "react"

import { cardVariants, stagger, useReducedMotion } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * Reusable motion wrappers so pages don't each duplicate motion variants
 * boilerplate. Built around `lib/motion.ts` — keeps `.ts` pure (variants
 * + timing) and `.tsx` for components that render motion nodes.
 *
 * - <PageStagger> wraps a page's top-level container. Stages children in
 *   with the small `cardVariants` y-offset + opacity, staggered by 40 ms.
 *   Mirror `<div className="flex flex-col gap-6">` semantics — drop-in.
 * - <StaggerItem> is the child variant. Wrap any block (Panel, KpiStrip,
 *   etc.) that you want to slide in as part of the cascade.
 * - <FadeIn> is a single-shot fade for content that's not part of a
 *   cascade (e.g. a "no results" state after a search).
 *
 * All three honor `prefers-reduced-motion` — when on, the wrappers render
 * a plain div with no animation rather than fighting the user's setting.
 */

const parentVariants: Variants = {
  initial: {},
  animate: { transition: stagger(0.045) },
  exit: { transition: stagger(0.03) },
}

interface PageStaggerProps {
  children: ReactNode
  className?: string
  /** Default `gap-6` matches the dashboard's section rhythm. */
  gap?: string
}

export function PageStagger({
  children,
  className,
  gap = "gap-6",
}: PageStaggerProps) {
  const reduce = useReducedMotion()
  if (reduce) {
    return <div className={cn("flex flex-col", gap, className)}>{children}</div>
  }
  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={parentVariants}
      className={cn("flex flex-col", gap, className)}
    >
      {children}
    </motion.div>
  )
}

interface StaggerItemProps {
  children: ReactNode
  className?: string
}

export function StaggerItem({ children, className }: StaggerItemProps) {
  const reduce = useReducedMotion()
  if (reduce) {
    return className ? <div className={className}>{children}</div> : <>{children}</>
  }
  return (
    <motion.div variants={cardVariants} className={className}>
      {children}
    </motion.div>
  )
}

/** Simple fade-in for one-off elements outside a stagger context. */
export function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduce = useReducedMotion()
  if (reduce) {
    return className ? <div className={className}>{children}</div> : <>{children}</>
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/**
 * AnimatePresence-wrapped list that stagger-mounts its children and
 * collapses them on exit. Use for device-grid / search-result grids
 * where items appear/disappear in response to filters or live data.
 *
 * Each direct child should have a stable `key` — the wrapper enforces
 * that by wrapping each child in a `<motion.div>` keyed on its
 * `props.key`. Children without a key are still animated but won't
 * benefit from AnimatePresence's exit choreography.
 */
export function AnimatedList({
  children,
  className,
  itemClassName,
}: {
  children: ReactNode
  className?: string
  itemClassName?: string
}) {
  const reduce = useReducedMotion()
  const items = Children.toArray(children).filter(isValidElement)
  if (reduce) {
    return <div className={className}>{items}</div>
  }
  return (
    <div className={className}>
      <AnimatePresence initial={true} mode="popLayout">
        {items.map((child, i) => (
          <motion.div
            key={(child.key as string) ?? `item-${i}`}
            layout
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={itemClassName}
          >
            {child}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
