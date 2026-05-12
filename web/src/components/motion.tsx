import { AnimatePresence, motion, type Variants } from "motion/react"
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"

import { cardVariants, EASING, TIMING, useReducedMotion } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * Reusable motion wrappers so pages don't each duplicate motion variants
 * boilerplate. Built around `lib/motion.ts` — keeps `.ts` pure (variants
 * + timing) and `.tsx` for components that render motion nodes.
 *
 * Design note on stagger:
 *   We don't use motion's `staggerChildren` + variant inheritance for the
 *   page-level cascade — that pattern is fragile under React Router +
 *   Suspense + AnimatePresence (the child can mount while the parent is
 *   already past its entry transition, and end up stuck at `initial`,
 *   leaving the page blank until a hard refresh).
 *
 *   Instead, <PageStagger> uses cloneElement to inject an incrementing
 *   `_staggerIndex` prop into each direct child, and <StaggerItem> is
 *   fully self-driven: it sets its own initial/animate/exit with a
 *   `delay` derived from that index. This is robust under any router /
 *   suspense ordering.
 */

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
  const items = Children.toArray(children).filter(isValidElement)
  if (reduce) {
    return (
      <div className={cn("flex flex-col", gap, className)}>{items}</div>
    )
  }
  // Walk direct children and clone any that accept _staggerIndex (i.e.
  // StaggerItem). Non-StaggerItem children are passed through untouched —
  // dialogs, AnimatePresence wrappers, fragments, etc. all still render
  // normally because cloneElement only adds the prop, it doesn't trigger
  // re-rendering with new behavior on components that ignore it.
  let stagger = 0
  return (
    <div className={cn("flex flex-col", gap, className)}>
      {items.map((child) => {
        if (!isValidElement(child)) return child
        if (child.type === StaggerItem) {
          const idx = stagger++
          return cloneElement(
            child as ReactElement<StaggerItemInternalProps>,
            { _staggerIndex: idx },
          )
        }
        return child
      })}
    </div>
  )
}

interface StaggerItemProps {
  children: ReactNode
  className?: string
}

interface StaggerItemInternalProps extends StaggerItemProps {
  /** Auto-injected by <PageStagger> — do not set manually. */
  _staggerIndex?: number
}

export function StaggerItem({
  children,
  className,
  _staggerIndex = 0,
}: StaggerItemInternalProps) {
  const reduce = useReducedMotion()
  if (reduce) {
    return className ? <div className={className}>{children}</div> : <>{children}</>
  }
  // Self-driven entry: no reliance on parent variant inheritance, so the
  // page always renders even if the AnimatePresence + Suspense ordering
  // skips the parent's `animate` transition.
  //
  // Stagger is anchored to TIMING.routeDelay so the first card lands
  // *after* the PageMount transition has had time to start, and stops
  // climbing past 0.48s so a 12-item page doesn't have items waiting
  // visibly. ~60 ms between cards feels deliberate without dragging.
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={{
        duration: TIMING.enter,
        ease: EASING.out,
        delay: Math.min(
          0.48,
          TIMING.routeDelay + _staggerIndex * 0.06,
        ),
      }}
      className={className}
    >
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: TIMING.enter, ease: EASING.out, delay }}
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
const listChildVariants: Variants = cardVariants

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
            variants={listChildVariants}
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
