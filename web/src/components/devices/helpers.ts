/** Right-align and sum N device history arrays into a single series of
 *  the given window. Same right-alignment logic the live-stats aggregate
 *  uses, but scoped to a caller-supplied id list so the chart can reflect
 *  the current filter. */
export function sumHistoriesRightAligned(
  ids: string[],
  source: Record<string, { rxHistory: number[]; txHistory: number[] }>,
  key: "rxHistory" | "txHistory",
  windowSize: number,
): number[] {
  let maxLen = 0
  const slices: number[][] = []
  for (const id of ids) {
    const arr = source[id]?.[key] ?? []
    if (arr.length === 0) continue
    const s = arr.slice(-windowSize)
    slices.push(s)
    if (s.length > maxLen) maxLen = s.length
  }
  if (maxLen === 0) return []
  const out = new Array<number>(maxLen).fill(0)
  for (const s of slices) {
    const offset = maxLen - s.length
    for (let i = 0; i < s.length; i++) {
      out[offset + i] += s[i]
    }
  }
  return out
}
