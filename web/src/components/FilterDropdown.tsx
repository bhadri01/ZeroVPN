import { IconCheck, IconChevronDown } from "@tabler/icons-react"

import { StatusPill, type Status as PillStatus } from "@/components/StatusPill"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/** Multi-select dropdown filter used to narrow lists on Devices, Finder,
 *  and anywhere else multiple state pills compose into a result set.
 *
 *  Renders a labelled trigger that reads <label> <summary> [badge] caret.
 *  Inside the popover is a checkbox-style list — clicking a row toggles
 *  selection without closing, matching how Linear / Notion / etc. handle
 *  multi-select filter chips. `counts` is keyed by option value so each
 *  row shows the matching row-count for that bucket.
 *
 *  Extracted from `web/src/pages/app/Devices.tsx` so the same UI affordance
 *  is reused on the Finder page.
 */
export function FilterDropdown<T extends string>({
  label,
  options,
  selected,
  onToggle,
  onClear,
  counts,
}: {
  label: string
  options: { value: T; label: string; pill: PillStatus }[]
  selected: Set<T>
  onToggle: (v: T) => void
  onClear: () => void
  counts: Record<string, number>
}) {
  const selectedLabels = options
    .filter((o) => selected.has(o.value))
    .map((o) => o.label)
  const summary =
    selected.size === 0
      ? "All"
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selected.size} selected`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          className={[
            "zv-filter-dd",
            selected.size > 0 && "zv-filter-dd--on",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="zv-filter-dd__label">{label}</span>
          <span className="zv-filter-dd__value">{summary}</span>
          {selected.size > 0 && (
            <span className="zv-filter-dd__badge">{selected.size}</span>
          )}
          <IconChevronDown
            size={12}
            className="text-muted-foreground"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0 font-mono text-xs">
        <div className="text-muted-foreground flex items-center justify-between border-b px-3 py-2">
          <span className="zv-eyebrow text-[10px]">{label}</span>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="hover:text-foreground"
            >
              clear
            </button>
          )}
        </div>
        <ul role="listbox" aria-multiselectable="true" className="py-1">
          {options.map((opt) => {
            const isOn = selected.has(opt.value)
            return (
              <li key={opt.value} role="option" aria-selected={isOn}>
                <button
                  type="button"
                  onClick={() => onToggle(opt.value)}
                  className="hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-1.5 text-left"
                >
                  <span
                    className={[
                      "zv-filter-dd__check",
                      isOn && "zv-filter-dd__check--on",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-hidden
                  >
                    {isOn && <IconCheck size={10} strokeWidth={3} />}
                  </span>
                  <StatusPill status={opt.pill} dotOnly />
                  <span className="flex-1">{opt.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {counts[opt.value] ?? 0}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
