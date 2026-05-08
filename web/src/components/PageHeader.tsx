import type { ReactNode } from "react"

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-1">
        {eyebrow && (
          <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-[0.08em]">
            {eyebrow}
          </p>
        )}
        <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[1.15]">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground max-w-2xl text-sm">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          {actions}
        </div>
      )}
    </div>
  )
}
