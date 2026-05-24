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

/** Two-note bell motif per variant, in Hz. Rising intervals read as
 *  positive/neutral; a gentle fall flags a problem without sounding like an
 *  alarm. Frequencies are real musical pitches so the pair is consonant. */
const CHIME_NOTES: Record<Variant, [number, number]> = {
  success: [659.25, 987.77], // E5 → B5, rising perfect fifth
  info: [659.25, 880.0], // E5 → A5, rising perfect fourth
  message: [659.25, 880.0],
  warning: [698.46, 587.33], // F5 → D5, gentle fall
  error: [587.33, 440.0], // D5 → A4, soft descending
}

/** One bell-like voice: a sine fundamental plus a quieter, slightly detuned
 *  octave partial for shimmer, shaped by a fast attack + smooth exponential
 *  decay and rolled off through a lowpass so it's warm, not piercing. */
function bellVoice(ctx: AudioContext, freq: number, start: number, peak: number) {
  const dur = 0.45
  const fund = ctx.createOscillator()
  const partial = ctx.createOscillator()
  const partialGain = ctx.createGain()
  const env = ctx.createGain()
  const tone = ctx.createBiquadFilter()

  fund.type = "sine"
  partial.type = "sine"
  fund.frequency.value = freq
  partial.frequency.value = freq * 2.005 // slight detune → soft beating/shimmer
  partialGain.gain.value = 0.28

  tone.type = "lowpass"
  tone.frequency.value = 3200
  tone.Q.value = 0.7

  // Envelope: ~8ms attack, then decay to silence. exponentialRamp can't hit 0,
  // so we ramp to a tiny floor.
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(peak, start + 0.008)
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur)

  fund.connect(env)
  partial.connect(partialGain).connect(env)
  env.connect(tone).connect(ctx.destination)

  fund.start(start)
  partial.start(start)
  fund.stop(start + dur + 0.05)
  partial.stop(start + dur + 0.05)
}

/** Short synthesized chime — no asset to ship, soft enough to coexist with
 *  stacked toasts. Plays the variant's two-note motif as a quick arpeggio. */
function playChime(variant: Variant) {
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
    const [a, b] = CHIME_NOTES[variant]
    const t = ctx.currentTime
    bellVoice(ctx, a, t, 0.09)
    bellVoice(ctx, b, t + 0.085, 0.075)
  } catch {
    // Autoplay rules sometimes throw before a user gesture — silent fail
    // is correct here, the toast itself still renders.
  }
}

export interface NotifyOptions extends ExternalToast {
  /** Mirror to the OS notifier when:
   *   - the user has opted in (`browser_notifications` preference)
   *   - permission is `granted`
   *   - the tab is currently hidden (so we don't double-fire with the toast)
   *  Reserve for events that matter when the user isn't looking. */
  important?: boolean
  /** Body for the OS notification. Defaults to `description` if a string. */
  body?: string
  /** In-app path to open when the OS notification is clicked (handled by the
   *  service worker — see public/sw.js). */
  url?: string
}

type Variant = "success" | "info" | "warning" | "error" | "message"

/**
 * Show an OS-level notification — nothing else (no toast, no sound). Honours
 * the user's opt-in, requires granted permission, and only fires while the tab
 * is hidden (a visible tab gets the in-app toast instead). Prefers the service
 * worker's `showNotification` (works on Android/desktop and supports
 * click-to-focus via the SW); falls back to the page-level `Notification`.
 *
 * Exported so flows that already showed their own in-app feedback (e.g. a
 * mutation's success toast) can still surface a heads-up on the user's *other*
 * backgrounded sessions without double-toasting the active one.
 */
export function osNotify(
  title: string,
  opts?: { body?: string; url?: string; tag?: string },
) {
  if (
    !config.browserNotifications ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted" ||
    typeof document === "undefined" ||
    document.visibilityState !== "hidden"
  ) {
    return
  }
  const data = { url: opts?.url ?? "/app" }
  const options: NotificationOptions = {
    body: opts?.body,
    tag: opts?.tag,
    icon: "/icon.svg",
    badge: "/icon.svg",
    data,
  }
  // Prefer the service worker registration when one is active — required for
  // notifications to work on mobile, and the only path that can refocus the
  // app on click.
  if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
    void navigator.serviceWorker.ready
      .then((reg) => reg.showNotification(title, options))
      .catch(() => fallbackNotification(title, options))
    return
  }
  fallbackNotification(title, options)
}

function fallbackNotification(title: string, options: NotificationOptions) {
  try {
    new Notification(title, options)
  } catch {
    // Some browsers throw if the permission state changed mid-flight, or
    // (e.g. Android) disallow the page-level constructor entirely.
  }
}

function fire(variant: Variant, title: string, opts?: NotifyOptions) {
  if (config.toastSound) playChime(variant)

  // Strip our local extensions before forwarding to sonner.
  const { important, body, url, ...sonnerOpts } = opts ?? {}
  void url

  if (variant === "message") toast(title, sonnerOpts)
  else toast[variant](title, sonnerOpts)

  if (important) {
    osNotify(title, {
      body:
        body ??
        (typeof opts?.description === "string" ? opts.description : undefined),
      url: opts?.url,
      tag: typeof opts?.id === "string" ? opts.id : undefined,
    })
  }
}

/** Play the chime once, ignoring the saved preference — for the settings
 *  toggle so the user hears the new sound the instant they enable it (the
 *  toggle click is the user gesture autoplay needs). */
export function previewChime() {
  playChime("success")
}

export const notify = {
  success: (title: string, opts?: NotifyOptions) => fire("success", title, opts),
  info: (title: string, opts?: NotifyOptions) => fire("info", title, opts),
  warning: (title: string, opts?: NotifyOptions) => fire("warning", title, opts),
  error: (title: string, opts?: NotifyOptions) => fire("error", title, opts),
  message: (title: string, opts?: NotifyOptions) => fire("message", title, opts),
}
