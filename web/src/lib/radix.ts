/**
 * Radix modal overlays (Dialog / Sheet / Select / DropdownMenu) occasionally
 * leave `pointer-events: none` stuck on `<body>` after they close — most often
 * when one overlay opens while another is still animating shut (e.g. a Select
 * inside a Dialog, or a Dialog opened from a closing DropdownMenu). The stray
 * lock makes the page — and any trigger inside it — unclickable, so a Select
 * "won't reopen" and the dialog feels frozen.
 *
 * This clears the stray lock once the close settles. It only acts when the body
 * is actually locked, and the overlay's own overlay element still guards
 * outside-clicks while it's open, so modality isn't weakened in practice.
 *
 * Wire it into a Radix Root's `onOpenChange` via {@link withBodyPointerEvents}.
 */
export function clearStuckBodyPointerEvents() {
  // Run after Radix's synchronous close cleanup. A double rAF survives a
  // re-lock that a sibling layer's own cleanup might apply on the next frame.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (document.body.style.pointerEvents === "none") {
        document.body.style.pointerEvents = ""
      }
    })
  })
}

/**
 * Wrap an `onOpenChange` handler so the body pointer-events lock is cleared
 * whenever the overlay closes, then the original handler still runs.
 */
export function withBodyPointerEvents(
  onOpenChange?: (open: boolean) => void,
): (open: boolean) => void {
  return (open: boolean) => {
    onOpenChange?.(open)
    if (!open) clearStuckBodyPointerEvents()
  }
}
