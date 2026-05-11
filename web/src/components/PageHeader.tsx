import type { ReactNode } from "react"

import { PageHead } from "./swiss"

/** Compatibility shim — older callers used `description` / `actions`; the
 * Swiss design renames these to `sub` / `right`. Keep the props but
 * forward to the new <PageHead> so we don't touch every page in one go. */
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
    <PageHead
      eyebrow={eyebrow}
      title={title}
      sub={description}
      right={actions}
    />
  )
}
