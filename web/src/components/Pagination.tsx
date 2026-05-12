import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Footer strip for admin tables. Always renders — even when the result
 * set fits on a single page — so the admin can see deployment totals at
 * a glance. Prev/Next disable when there's nothing to navigate to.
 *
 * When `onPageSizeChange` is provided, also renders a "rows: 25/50/100"
 * selector so the admin can widen or narrow each page without dropping
 * out to the URL bar.
 */
export function Pagination({
  page,
  pageSize,
  total,
  itemCount,
  fetching,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 200],
}: {
  /** Zero-based page index. */
  page: number
  pageSize: number
  /** Total rows in the (possibly filtered) result set. */
  total: number
  /** Number of rows actually rendered — drives the right side of the
   *  `from–to of total` label so the last page reads "991–1000" rather
   *  than "991–1050" when the page is partial. */
  itemCount: number
  fetching: boolean
  onPageChange: (next: number) => void
  /** Omit to hide the rows-per-page selector entirely. */
  onPageSizeChange?: (next: number) => void
  pageSizeOptions?: number[]
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const fromIdx = total === 0 ? 0 : page * pageSize + 1
  const toIdx = Math.min(total, page * pageSize + itemCount)
  return (
    <div className="border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2 font-mono text-[11px]">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
        <span>
          <span className="text-foreground">
            {fromIdx.toLocaleString()}–{toIdx.toLocaleString()}
          </span>{" "}
          of <span className="text-foreground">{total.toLocaleString()}</span>
        </span>
        {onPageSizeChange ? (
          <span className="flex items-center gap-1.5">
            <span>rows</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
              disabled={fetching}
            >
              <SelectTrigger className="h-6 w-[68px] px-2 py-0 font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        ) : (
          <span>
            rows <span className="text-foreground">{pageSize}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0 || fetching}
        >
          ← Prev
        </Button>
        <span className="text-muted-foreground tabular-nums">
          page <span className="text-foreground">{page + 1}</span> /{" "}
          <span className="text-foreground">{pageCount}</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          disabled={page >= pageCount - 1 || fetching}
        >
          Next →
        </Button>
      </div>
    </div>
  )
}
