import { create } from "zustand"

interface BreadcrumbState {
  /** Map of route id → override label. Set by `useBreadcrumbOverride`. */
  overrides: Record<string, string>
  set(routeId: string, label: string | null): void
}

/**
 * Lets a leaf page replace the static `handle.breadcrumb` of its matched
 * route with a dynamic value, e.g. the device name on `/app/devices/:id`.
 *
 * Reads happen in the TopBar; writes happen via `useBreadcrumbOverride`
 * inside the page (cleared on unmount).
 */
export const useBreadcrumbStore = create<BreadcrumbState>((set) => ({
  overrides: {},
  set(routeId, label) {
    set((state) => {
      if (label === null) {
        if (!(routeId in state.overrides)) return state
        const next = { ...state.overrides }
        delete next[routeId]
        return { overrides: next }
      }
      if (state.overrides[routeId] === label) return state
      return { overrides: { ...state.overrides, [routeId]: label } }
    })
  },
}))
