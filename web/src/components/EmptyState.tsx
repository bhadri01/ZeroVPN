import type { ComponentType, ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Mercury-style empty state: an icon, a one-line headline, optional
 * description, and a primary CTA that *creates the missing thing* — never
 * just "Add". The CTA is the path of least resistance.
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
        "border-border bg-card/30 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="bg-muted text-muted-foreground mb-1 flex size-9 items-center justify-center rounded-full">
          <Icon className="size-4" />
        </div>
      )}
      <h3 className="text-sm font-medium">{title}</h3>
      {description && (
        <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
