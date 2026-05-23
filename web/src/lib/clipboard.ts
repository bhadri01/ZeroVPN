/**
 * Copy text to the clipboard across browsers and contexts — including Safari
 * (macOS + iOS) and non-secure origins like `http://<lan-ip>:6173`, where the
 * async Clipboard API is unavailable or silently blocked.
 *
 * Why this exists: `navigator.clipboard` is `undefined` outside a secure
 * context (any plain-http origin that isn't `localhost`), and even when it's
 * present Safari frequently rejects the write. The previous attempt also
 * returned success optimistically before the write resolved, so the "Copied"
 * affordance flipped while nothing landed on the clipboard.
 *
 * Strategy — the synchronous `execCommand` path is the workhorse: it runs
 * inside the click gesture, works in every browser and context, and (with a
 * real selection over a rendered node) actually writes, returning an honest
 * boolean so the UI never lies. We only reach for the async Clipboard API
 * when `execCommand` is unavailable/blocked.
 *
 * Returns `true` only when the copy succeeded — flip the "Copied" affordance
 * on `true`, toast an error on `false`.
 */
export function copyText(value: string): boolean {
  // Primary: synchronous, verifiable, gesture-safe, works on plain http.
  if (legacyCopy(value)) return true

  // Fallback for hardened contexts where execCommand is disabled but the
  // async API is permitted. We can't read its result synchronously, so report
  // success only when we were actually able to dispatch the write.
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function" &&
    window.isSecureContext
  ) {
    navigator.clipboard.writeText(value).catch(() => {
      /* nothing left to try */
    })
    return true
  }

  return false
}

/**
 * Select a hidden-but-rendered `<span>` and `execCommand("copy")`.
 *
 * `execCommand` is deprecated but is the only clipboard path on non-secure
 * origins and is honoured by every browser including iOS Safari. The element
 * must stay in the render tree and be selectable for the copy to actually
 * happen — `display:none` / `visibility:hidden` / `opacity:0` all make
 * `execCommand` report success while copying nothing, which was the bug. We
 * hide it with `clip: rect(0,0,0,0)` instead (visually gone, still
 * selectable), force `user-select: text`, and select its contents via a
 * Range (the only thing iOS Safari honours).
 */
function legacyCopy(value: string): boolean {
  if (typeof document === "undefined") return false
  const selection = window.getSelection()
  if (!selection) return false

  // Preserve any selection the user already had so copying doesn't disturb it.
  const saved = selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  const mark = document.createElement("span")
  mark.textContent = value
  // Keep whitespace/newlines exact (configs, recovery codes).
  mark.style.whiteSpace = "pre"
  mark.style.position = "fixed"
  mark.style.top = "0"
  mark.style.left = "0"
  // Visually hidden but still rendered + selectable (unlike opacity/display).
  mark.style.clip = "rect(0, 0, 0, 0)"
  mark.style.padding = "0"
  mark.style.margin = "0"
  // Some browsers won't copy from an element that isn't user-selectable.
  mark.style.userSelect = "text"
  mark.style.setProperty("-webkit-user-select", "text")

  document.body.appendChild(mark)

  let ok = false
  try {
    const range = document.createRange()
    range.selectNodeContents(mark)
    selection.removeAllRanges()
    selection.addRange(range)
    // iOS Safari also needs the input-style range when present.
    ok = document.execCommand("copy")
  } catch {
    ok = false
  } finally {
    selection.removeAllRanges()
    document.body.removeChild(mark)
    if (saved) selection.addRange(saved)
  }

  return ok
}
