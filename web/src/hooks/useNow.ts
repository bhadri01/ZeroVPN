import { useEffect, useState } from "react"

import { isPageVisible } from "@/hooks/usePageVisible"

/**
 * Re-renders the caller on a fixed interval, returning the current
 * `Date.now()`. Use it to drive live relative-time labels ("3s ago") and
 * any state derived from "how long ago" (e.g. a handshake/keepalive
 * staleness check) so the UI updates without waiting on a network event.
 *
 * Pauses while the tab is hidden — there's no point re-rendering an
 * unseen view at 1 Hz — and snaps to the current time the moment the tab
 * becomes visible again so the label is correct on return.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
    const start = () => {
      stop()
      if (isPageVisible()) {
        setNow(Date.now())
        timer = setInterval(() => setNow(Date.now()), intervalMs)
      }
    }
    start()
    document.addEventListener("visibilitychange", start)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", start)
    }
  }, [intervalMs])

  return now
}
