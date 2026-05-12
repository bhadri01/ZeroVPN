import { useMemo } from "react"

import { cn } from "@/lib/utils"

/**
 * Deterministic pixel-grid avatar. Same seed → same image, every time.
 * Modeled on GitHub's identicons: a square pixel grid (5×5 by default)
 * with horizontal mirror symmetry around the centre column, painted in
 * a single hash-derived hue.
 *
 * The seed is the user's email (lower-cased before hashing so casing
 * differences in display don't change the avatar). Hash is FNV-1a 32-
 * bit — fast, dependency-free, sufficient entropy for a 15-cell
 * decision grid + a 9-bit hue. We don't need crypto here; the goal is
 * visual stability, not resistance to inversion.
 *
 * The component returns inline SVG sized to the requested px. Wrapping
 * with a bordered box (e.g. `<span class="border bg-card size-7">…</span>`)
 * matches the rest of the design system's sharp 2px aesthetic.
 */
export function Identicon({
  seed,
  size = 28,
  cells = 5,
  background,
  className,
  title,
}: {
  /** Stable string used to derive the avatar. Usually `user.email`. */
  seed: string
  /** Output dimensions in CSS pixels. Square. */
  size?: number
  /** Grid resolution. 5 matches the GitHub feel; 7+ looks more
   *  textured. The grid is always mirrored horizontally so the
   *  effective entropy is `cells × ceil(cells/2)` bits. */
  cells?: number
  /** Background colour painted behind unfilled cells. Defaults to
   *  transparent so the parent's surface shows through. */
  background?: string
  className?: string
  /** Optional accessible label. When omitted the SVG is `aria-hidden`
   *  (the avatar is decorative — the surrounding email/name is what
   *  screen-reader users care about). */
  title?: string
}) {
  const { color, filled } = useMemo(
    () => buildPattern(seed, cells),
    [seed, cells],
  )

  return (
    <svg
      viewBox={`0 0 ${cells} ${cells}`}
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      className={cn("block", className)}
    >
      {background && (
        <rect width={cells} height={cells} fill={background} />
      )}
      {filled.map((row, ri) =>
        row.map((on, ci) =>
          on ? (
            <rect
              key={`${ri}-${ci}`}
              x={ci}
              y={ri}
              width={1}
              height={1}
              fill={color}
            />
          ) : null,
        ),
      )}
    </svg>
  )
}

/* ── hash + pattern derivation ──────────────────────────────────────── */

function hashFnv32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    // 32-bit FNV prime; Math.imul truncates to 32 bits per spec.
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function buildPattern(seed: string, cells: number) {
  const h = hashFnv32(seed.toLowerCase().trim())

  // Hue: spread evenly across the wheel. Fixed saturation/lightness so
  // every identicon reads at the same visual weight on both light and
  // dark surfaces.
  const hue = h % 360
  const color = `hsl(${hue}deg 62% 50%)`

  // Decide which cells in the left half (incl. centre column for odd
  // widths) are filled. Each cell pulls one bit from a slot-specific
  // mix of the hash so wider grids don't repeat the same 32-bit chunk.
  const half = Math.ceil(cells / 2)
  const filled: boolean[][] = []
  let bit = 0
  for (let row = 0; row < cells; row++) {
    const left: boolean[] = []
    for (let col = 0; col < half; col++) {
      // Re-mix the hash per cell with a Weyl-style multiplier so
      // each cell sees a different bit pattern even for short seeds.
      const mix = h ^ Math.imul(0x9e3779b1, bit + 1)
      left.push(((mix >>> ((bit * 7) & 31)) & 1) === 1)
      bit++
    }
    // Mirror onto the right half. For odd widths, the centre column
    // (index `half - 1`) is NOT duplicated.
    const row_cells = left.slice()
    for (let col = cells - half - 1; col >= 0; col--) {
      row_cells.push(left[col])
    }
    filled.push(row_cells)
  }
  return { color, filled }
}
