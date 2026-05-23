/**
 * Date/time formatting that honors the user's saved preferences
 * (date_format: iso/us/eu, time_format: h24/h12). The module-level prefs are
 * set once from the user's preferences (see PreferencesSync) so the `format*`
 * helpers stay zero-arg and drop into existing call sites; the `*With`
 * variants are pure and used by the Settings preview.
 */
import type { DateFormatPref, TimeFormatPref } from "@/lib/api"

let dateFmt: DateFormatPref = "iso"
let timeFmt: TimeFormatPref = "h24"

export function setDateTimePrefs(d: DateFormatPref, t: TimeFormatPref) {
  dateFmt = d
  timeFmt = t
}

function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v)
}

export function formatDateWith(v: Date | string | number, fmt: DateFormatPref): string {
  const d = toDate(v)
  if (Number.isNaN(d.getTime())) return "—"
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const da = String(d.getDate()).padStart(2, "0")
  if (fmt === "us") return `${mo}/${da}/${y}`
  if (fmt === "eu") return `${da}/${mo}/${y}`
  return `${y}-${mo}-${da}` // iso
}

export function formatTimeWith(v: Date | string | number, fmt: TimeFormatPref): string {
  const d = toDate(v)
  if (Number.isNaN(d.getTime())) return "—"
  const m = String(d.getMinutes()).padStart(2, "0")
  if (fmt === "h12") {
    const ap = d.getHours() < 12 ? "AM" : "PM"
    let h = d.getHours() % 12
    if (h === 0) h = 12
    return `${h}:${m} ${ap}`
  }
  return `${String(d.getHours()).padStart(2, "0")}:${m}`
}

export function formatDateTimeWith(
  v: Date | string | number,
  df: DateFormatPref,
  tf: TimeFormatPref,
): string {
  return `${formatDateWith(v, df)} ${formatTimeWith(v, tf)}`
}

export const formatDate = (v: Date | string | number) => formatDateWith(v, dateFmt)
export const formatTime = (v: Date | string | number) => formatTimeWith(v, timeFmt)
export const formatDateTime = (v: Date | string | number) =>
  formatDateTimeWith(v, dateFmt, timeFmt)

/**
 * Compact, **seconds-precise** "time ago" label, e.g. `now`, `5s ago`,
 * `45s ago`, `3m 12s ago`, `2h 4m ago`, `5d 3h ago`. Seconds are kept all
 * the way up to the hour so a recently-seen device reads precisely instead
 * of rounding to a coarse "1 minute ago".
 *
 * `nowMs` is passed in (rather than read from `Date.now()` internally) so a
 * caller driving a 1 Hz tick — see `useNow` — controls when it recomputes,
 * keeping the function pure and the label live.
 */
export function formatAgo(
  value: Date | string | number | null | undefined,
  nowMs: number,
  fallback = "—",
): string {
  if (value == null) return fallback
  const then = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (Number.isNaN(then)) return fallback
  const totalSec = Math.max(0, Math.round((nowMs - then) / 1000))
  if (totalSec < 1) return "now"
  if (totalSec < 60) return `${totalSec}s ago`
  const min = Math.floor(totalSec / 60)
  if (min < 60) return `${min}m ${totalSec % 60}s ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m ago`
  const day = Math.floor(hr / 24)
  return `${day}d ${hr % 24}h ago`
}
