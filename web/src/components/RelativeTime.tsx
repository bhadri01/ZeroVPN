import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const UNITS: Array<{ ms: number; one: string; many: string }> = [
  { ms: 365 * 24 * 60 * 60 * 1000, one: "year", many: "years" },
  { ms: 30 * 24 * 60 * 60 * 1000, one: "month", many: "months" },
  { ms: 7 * 24 * 60 * 60 * 1000, one: "week", many: "weeks" },
  { ms: 24 * 60 * 60 * 1000, one: "day", many: "days" },
  { ms: 60 * 60 * 1000, one: "hour", many: "hours" },
  { ms: 60 * 1000, one: "minute", many: "minutes" },
  { ms: 1000, one: "second", many: "seconds" },
]

function relative(when: Date | string | number | null | undefined): string {
  if (when == null) return "—"
  const d = when instanceof Date ? when : new Date(when)
  const diff = Date.now() - d.getTime()
  if (Number.isNaN(diff)) return "—"
  const past = diff >= 0
  const abs = Math.abs(diff)
  if (abs < 30 * 1000) return past ? "just now" : "in a moment"
  for (const u of UNITS) {
    const n = Math.round(abs / u.ms)
    if (n >= 1) {
      const unit = n === 1 ? u.one : u.many
      return past ? `${n} ${unit} ago` : `in ${n} ${unit}`
    }
  }
  return d.toLocaleString()
}

export function RelativeTime({
  value,
  fallback = "—",
}: {
  value: Date | string | number | null | undefined
  fallback?: string
}) {
  if (value == null) {
    return <span className="text-muted-foreground">{fallback}</span>
  }
  const d = value instanceof Date ? value : new Date(value)
  const text = relative(d)
  const absolute = d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default whitespace-nowrap">{text}</span>
      </TooltipTrigger>
      <TooltipContent className="font-mono text-xs" side="top">
        {absolute}
      </TooltipContent>
    </Tooltip>
  )
}
