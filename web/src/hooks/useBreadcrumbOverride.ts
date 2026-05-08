import { useEffect } from "react"
import { useMatches } from "react-router"

import { useBreadcrumbStore } from "@/stores/breadcrumb"

/**
 * Replaces the matched route's breadcrumb label with a runtime value.
 *
 * Page usage:
 *   useBreadcrumbOverride(device?.name ?? null)
 *
 * Pass `null` (or omit) to fall back to the route's static `handle.breadcrumb`.
 * The override is keyed by the deepest route id in the match tree, so each
 * page only affects its own crumb.
 */
export function useBreadcrumbOverride(label: string | null | undefined) {
  const matches = useMatches()
  const set = useBreadcrumbStore((s) => s.set)

  // The deepest match is the leaf page itself.
  const leafId = matches[matches.length - 1]?.id ?? ""

  useEffect(() => {
    if (!leafId) return
    set(leafId, label && label.trim() ? label : null)
    return () => {
      set(leafId, null)
    }
  }, [leafId, label, set])
}
