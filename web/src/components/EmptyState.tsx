import type { ComponentType, ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Swiss empty state: hairline-dashed box, mono headline, terse copy, CTA
 * below. No filled-circle icon halo — just the glyph in a small bordered
 * square so the surface stays paper-flat.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "border-border bg-card flex flex-col items-center justify-center gap-3 border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="border-border text-muted-foreground mb-1 flex size-9 items-center justify-center border">
          <Icon className="size-4" />
        </div>
      )}
      <h3 className="font-heading text-base font-medium">{title}</h3>
      {description && (
        <p className="text-muted-foreground max-w-md text-[13px] leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
