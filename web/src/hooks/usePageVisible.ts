import { useEffect, useState } from "react"

/**
 * Reactive Page Visibility — returns `true` when the tab is in the
 * foreground, `false` when hidden (background tab, minimized window,
 * device sleep, etc.).
 *
 * Used to gate hot UI updates: when the tab is hidden the user can't
 * see the chart, so allocating fresh history arrays at 1 Hz per device
 * is pure waste. Letting V8 GC the unused arrays keeps the renderer
 * process from being killed by Chrome with the "Aw, Snap!" OOM page.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => {
    if (typeof document === "undefined") return true
    return document.visibilityState !== "hidden"
  })

  useEffect(() => {
    if (typeof document === "undefined") return
    const onChange = () => {
      setVisible(document.visibilityState !== "hidden")
    }
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [])

  return visible
}

/**
 * Imperative variant that doesn't trigger React re-renders. Useful for
 * inside event handlers / store actions where you want to early-out
 * without subscribing.
 */
export function isPageVisible(): boolean {
  if (typeof document === "undefined") return true
  return document.visibilityState !== "hidden"
}
