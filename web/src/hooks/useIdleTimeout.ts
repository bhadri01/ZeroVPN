import { useEffect, useRef } from "react"
import { toast } from "sonner"

/**
 * Watches for user activity and:
 * - Toasts at `warnAfterMs` ("Sign out in N seconds — click to stay signed in")
 * - Calls `onTimeout` at `timeoutAfterMs`
 *
 * The warning toast lets the user click "Stay signed in" to reset; the
 * server enforces the same 30-minute window via tower-sessions, so this
 * hook is purely a UX courtesy.
 */
export function useIdleTimeout(opts: {
  warnAfterMs?: number
  timeoutAfterMs?: number
  onTimeout: () => void
  enabled?: boolean
}) {
  const {
    warnAfterMs = 25 * 60 * 1000,
    timeoutAfterMs = 30 * 60 * 1000,
    onTimeout,
    enabled = true,
  } = opts
  const lastActivity = useRef(Date.now())
  const onTimeoutRef = useRef(onTimeout)
  onTimeoutRef.current = onTimeout

  useEffect(() => {
    if (!enabled) return

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"]
    const reset = () => {
      lastActivity.current = Date.now()
    }
    for (const ev of events) {
      window.addEventListener(ev, reset, { passive: true })
    }

    let warnedToastId: string | number | null = null

    const tick = setInterval(() => {
      const idle = Date.now() - lastActivity.current
      if (idle >= timeoutAfterMs) {
        onTimeoutRef.current()
      } else if (idle >= warnAfterMs && warnedToastId == null) {
        warnedToastId = toast.warning("You'll be signed out for inactivity in 5 min", {
          duration: Infinity,
          action: {
            label: "Stay signed in",
            onClick: () => {
              lastActivity.current = Date.now()
              if (warnedToastId != null) {
                toast.dismiss(warnedToastId)
                warnedToastId = null
              }
            },
          },
        })
      } else if (idle < warnAfterMs && warnedToastId != null) {
        toast.dismiss(warnedToastId)
        warnedToastId = null
      }
    }, 30_000)

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, reset)
      }
      if (warnedToastId != null) toast.dismiss(warnedToastId)
      clearInterval(tick)
    }
  }, [warnAfterMs, timeoutAfterMs, enabled])
}
