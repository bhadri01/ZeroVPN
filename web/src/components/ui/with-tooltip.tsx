import type * as React from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type Side = "top" | "right" | "bottom" | "left"

/**
 * Generic tooltip wrapper. Pass any clickable element (button, anchor,
 * Link, custom icon button) as the single child — it becomes the
 * tooltip trigger via Radix `asChild`. The tooltip text comes from
 * `label`; alignment from optional `side` (defaults to `top`).
 *
 * Mounts a `TooltipProvider` at the dashboard layout, so any usage
 * inside the authenticated app inherits the same delay/animation. For
 * unauthenticated pages, wrap manually if needed.
 *
 * The trigger child must accept a ref + DOM event props (Radix's
 * `asChild` injects them). Most native elements and component
 * forwardRefs do — components that swallow refs will break silently.
 */
export function WithTooltip({
  label,
  side = "top",
  delayDuration,
  children,
}: {
  label: React.ReactNode
  side?: Side
  delayDuration?: number
  children: React.ReactElement
}) {
  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
