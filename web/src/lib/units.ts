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

export function formatBps(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return "0 bps"
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`
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
