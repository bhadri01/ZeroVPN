/**
 * Register the PWA service worker (public/sw.js).
 *
 * The SW makes the app installable and powers OS-notification display + click
 * handling (focus/navigate). It does no caching, so it's safe to register in
 * dev too — it won't interfere with Vite HMR. Registration is best-effort:
 * a failure (e.g. unsupported browser, insecure context) is logged and the
 * app keeps working with in-app toasts only.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("Service worker registration failed:", err)
    })
  })
}
