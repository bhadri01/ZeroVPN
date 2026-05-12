/**
 * App-wide notification helper.
 *
 * Wraps Sonner's `toast` so every user-facing notification flows through a
 * single seam that can honour the user's preferences:
 *   - position (read by the global Toaster, see components/ui/sonner.tsx)
 *   - chime on each toast
 *   - mirroring to the OS Notifications API for "important" events
 *
 * Use `notify.*` instead of importing `toast` from "sonner" directly when
 * the notification should respect the user's notification settings. The
 * raw `toast` import is still fine for ephemeral feedback that should
 * always be silent (e.g. mid-form validation hints).
 */
import { toast, type ExternalToast } from "sonner"

import type { ToastPositionPref } from "@/lib/api"

interface NotifyConfig {
  toastSound: boolean
  browserNotifications: boolean
  position: ToastPositionPref
}

let config: NotifyConfig = {
  toastSound: false,
  browserNotifications: false,
  position: "bottom-right",
}

/** Pushed by the Toaster wrapper whenever the cached preferences change.
 *  Module-level state means callers anywhere can `notify.x(...)` without
 *  threading a context through. */
export function setNotifyConfig(next: Partial<NotifyConfig>) {
  config = { ...config, ...next }
}

let audioCtx: AudioContext | null = null

/** Short synthesized chime — no asset to ship, soft enough to coexist
 *  with stacked toasts. */
function playChime() {
  if (typeof window === "undefined") return
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return
    audioCtx ??= new Ctor()
    const ctx = audioCtx
    if (ctx.state === "suspended") void ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.18)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.24)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.26)
  } catch {
    // Autoplay rules sometimes throw before a user gesture — silent fail
    // is correct here, the toast itself still renders.
  }
}

export interface NotifyOptions extends ExternalToast {
  /** Mirror to the OS notifier (Notifications API) when:
   *   - the user has opted in (`browser_notifications` preference)
   *   - permission is `granted`
   *   - the tab is currently hidden (so we don't double-fire with the toast)
   *  Reserve for events that matter when the user isn't looking. */
  important?: boolean
  /** Body for the OS notification. Defaults to `description` if a string. */
  body?: string
}

type Variant = "success" | "info" | "warning" | "error" | "message"

function fire(variant: Variant, title: string, opts?: NotifyOptions) {
  if (config.toastSound) playChime()

  // Strip our local extensions before forwarding to sonner.
  const { important, body, ...sonnerOpts } = opts ?? {}
  void important
  void body

  if (variant === "message") toast(title, sonnerOpts)
  else toast[variant](title, sonnerOpts)

  if (
    opts?.important &&
    config.browserNotifications &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted" &&
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    try {
      new Notification(title, {
        body:
          opts.body ??
          (typeof opts.description === "string" ? opts.description : undefined),
        tag: typeof opts.id === "string" ? opts.id : undefined,
        icon: "/favicon.ico",
      })
    } catch {
      // Some browsers throw if the permission state changed mid-flight.
    }
  }
}

export const notify = {
  success: (title: string, opts?: NotifyOptions) => fire("success", title, opts),
  info: (title: string, opts?: NotifyOptions) => fire("info", title, opts),
  warning: (title: string, opts?: NotifyOptions) => fire("warning", title, opts),
  error: (title: string, opts?: NotifyOptions) => fire("error", title, opts),
  message: (title: string, opts?: NotifyOptions) => fire("message", title, opts),
}
