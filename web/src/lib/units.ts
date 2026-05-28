/**
 * Centralized unit formatting. Three copies of `formatBps` and two of
 * `formatBytes` used to live in the consumer components — they all
 * agreed on the format, but drift was a matter of time. One source here.
 *
 * Conventions:
 * - Rates use **decimal** prefixes (bps / kbps / Mbps / Gbps) — matches
 *   network-gear convention.
 * - Totals use **binary** prefixes (B / KB / MB / GB / TB based on 1024)
 *   — matches what disk / OS counters report.
 */

import type { UnitsPref } from "@/lib/api"

// Module-level throughput-units preference, set once from the user's saved
// preferences (see PreferencesSync). Mirrors the notify.ts setter pattern so
// the pure `formatBps` call sites (charts/KPIs/sidebar) need no changes.
let unitsPref: UnitsPref = "bps"
export function setUnitsPref(u: UnitsPref) {
  unitsPref = u
}

/** Format a bits-per-second rate. `units` selects bits/s (kbps/Mbps) vs
 * bytes/s (KB/s, MB/s — divides by 8). Pure — used directly by the Settings
 * preview. */
export function formatBpsWith(bps: number, units: UnitsPref): string {
  if (!Number.isFinite(bps) || bps < 0) return units === "Bps" ? "0 B/s" : "0 bps"
  if (units === "Bps") {
    const v = bps / 8
    if (v < 1024) return `${Math.round(v)} B/s`
    if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB/s`
    if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB/s`
    return `${(v / 1024 ** 3).toFixed(2)} GB/s`
  }
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

export function formatBps(bps: number): string {
  return formatBpsWith(bps, unitsPref)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`
}

/** Decimal / SI byte formatter (1 kB = 1000). Match this where the value
 *  originates from a system that uses SI conventions — most notably
 *  `docker stats`' Net I/O / Block I/O columns, which print `MB`/`GB`
 *  (not `MiB`/`GiB`) and divide by 1000. Using the binary `formatBytes`
 *  there produces numbers ~4–7% lower than `docker stats` and makes the
 *  sidebar look subtly out of sync with the CLI. */
export function formatBytesSI(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B"
  if (bytes < 1000) return `${Math.round(bytes)} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes < 1_000_000_000_000)
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  return `${(bytes / 1_000_000_000_000).toFixed(2)} TB`
}

/** Compact byte counter ("12k", "3.4M") for KPI strips where the unit
 * suffix would crowd the display. Pair with a fixed-unit label next to it.
 * Uses decimal prefixes — KPI cards traditionally show 1k = 1000. */
export function compactBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0"
  if (n < 1_000) return `${Math.round(n)}`
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return `${(n / 1_000_000_000).toFixed(2)}G`
}
