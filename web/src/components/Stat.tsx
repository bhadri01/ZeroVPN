import { motion, useMotionValue, useSpring, useTransform } from "motion/react"
import { useEffect } from "react"

import { TIMING, useReducedMotion } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * Swiss KPI tile. Hairline frame, mono uppercase label, big tabular
 * display number that tweens between values. Drops the previous radial
 * halo + Card chrome — those came from the round/violet era. Use this
 * as a child of `KpiStrip` for the four-up bordered grid, or stand-alone
 * inside any panel.
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
    <div className={cn("zv-kpi", className)}>
      <div className="zv-kpi-label">
        <span>{label}</span>
      </div>
      <div className="zv-kpi-val font-heading flex items-baseline gap-1.5">
        {reduceMotion ? (
          <span>
            {format ? format(value) : Math.round(value).toLocaleString()}
          </span>
        ) : (
          <motion.span>{display}</motion.span>
        )}
        {unit && <sup>{unit}</sup>}
      </div>
      {hint && <div className="zv-kpi-foot">{hint}</div>}
    </div>
  )
}
