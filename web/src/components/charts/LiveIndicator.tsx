/**
 * Tiny pulse indicator for "this chart is live". Pair with the chart's
 * card header.
 */
export function LiveIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
      <span className="zv-live-dot" />
      Live
    </span>
  )
}
