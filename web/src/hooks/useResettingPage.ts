import { useCallback, useState } from "react"

/**
 * Zero-based page index that snaps back to 0 whenever `key` changes — pass a
 * fingerprint of the active filters + page size. A stored page only counts
 * while its key still matches, so a filter change resets pagination in the
 * same render instead of via a `useEffect(() => setPage(0), [filters])`
 * (which costs an extra render and violates react-hooks/set-state-in-effect).
 */
export function useResettingPage(key: string) {
  const [state, setState] = useState({ key, page: 0 })
  const page = state.key === key ? state.page : 0
  const setPage = useCallback((page: number) => setState({ key, page }), [key])
  return [page, setPage] as const
}
