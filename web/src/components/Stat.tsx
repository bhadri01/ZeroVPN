import { motion, useMotionValue, useSpring, useTransform } from "motion/react"
import { useEffect } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { TIMING, useReducedMotion } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * Big-number tile that tweens between values via motion useSpring.
 *
 * Premium pass:
 *   - large display number (text-3xl, tracking-tight, tabular)
 *   - eyebrow label uppercase + tracking-wider in muted-foreground
 *   - faint primary-tinted radial accent in the top-right corner so
 *     the card has a subtle directional "light source" without
 *     drowning in gradient
 *   - hint stays small at the bottom
 *
 * Honors `prefers-reduced-motion` (jumps directly to the value).
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  format,
  className,
}: {
  label: string
  value: number
  unit?: string
  hint?: string
  format?: (v: number) => string
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const mv = useMotionValue(value)
  const sp = useSpring(mv, TIMING.stat)
  const display = useTransform(sp, (v) =>
    format ? format(v) : Math.round(v).toLocaleString(),
  )

  useEffect(() => {
    mv.set(value)
  }, [value, mv])

  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        // soft top-right primary halo (premium "lit corner" feel)
        "before:pointer-events-none before:absolute before:-right-12 before:-top-12 before:h-32 before:w-32 before:rounded-full",
        "before:bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)]",
        "before:opacity-60",
        className,
      )}
    >
      <CardContent className="relative z-10 px-5 py-4">
        <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-[0.08em]">
          {label}
        </p>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          {reduceMotion ? (
            <span className="text-3xl font-semibold tabular-nums tracking-tight">
              {format ? format(value) : Math.round(value).toLocaleString()}
            </span>
          ) : (
            <motion.span className="text-3xl font-semibold tabular-nums tracking-tight">
              {display}
            </motion.span>
          )}
          {unit && (
            <span className="text-muted-foreground text-[11px] font-medium">
              {unit}
            </span>
          )}
        </div>
        {hint && (
          <p className="text-muted-foreground mt-1 text-[11px]">{hint}</p>
        )}
      </CardContent>
    </Card>
  )
}
