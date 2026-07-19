/** Split a pasted finder query into individual lookup tokens. Accepts
 *  commas, whitespace, and newlines as separators and strips any CIDR
 *  suffix — `"10.10.0.5/32, 10.10.0.7\n10.10.0.9"` → three bare IPs.
 *  Order is kept, duplicates dropped. */
export function parseTokens(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(/[\s,]+/)) {
    const tok = raw.trim().split("/")[0]?.trim() ?? ""
    if (tok && !out.includes(tok)) out.push(tok)
  }
  return out
}
