import { motion, useMotionValue, useSpring, useTransform } from "motion/react"
import { useEffect } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { TIMING, useReducedMotion } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * Big-number tile that tweens between values via motion useSpring. Used for
 * RX/TX rates, peer counts, total bandwidth. Spring underdamping is gentle —
 * never bouncy enough to register as a separate motion event.
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
    <Card className={cn("border-border bg-card transition-colors", className)}>
      <CardContent className="px-4 py-3">
        <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
          {label}
        </p>
        <div className="mt-1 flex items-baseline gap-1.5">
          {reduceMotion ? (
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {format ? format(value) : Math.round(value).toLocaleString()}
            </span>
          ) : (
            <motion.span className="text-2xl font-semibold tracking-tight tabular-nums">
              {display}
            </motion.span>
          )}
          {unit && (
            <span className="text-muted-foreground text-xs font-medium">
              {unit}
            </span>
          )}
        </div>
        {hint && (
          <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
        )}
      </CardContent>
    </Card>
  )
}
