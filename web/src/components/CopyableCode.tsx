import { IconCheck, IconCopy } from "@tabler/icons-react"
import { useCallback, useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * Click-anywhere-to-copy mono block. 1.5 s "Copied" affordance.
 * Used for UUIDs, public keys, IPs, tokens, .conf snippets.
 */
export function CopyableCode({
  value,
  className,
  multiline = false,
  truncate = false,
}: {
  value: string
  className?: string
  multiline?: boolean
  truncate?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      /* noop */
    }
  }, [value])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      onClick={onCopy}
      title="Click to copy"
      className={cn(
        "group border-border bg-muted relative inline-flex w-full items-start gap-2 border px-3 py-2 text-left font-mono text-xs transition-colors hover:border-foreground",
        multiline ? "items-start" : "items-center",
        className,
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1",
          multiline
            ? "whitespace-pre-wrap break-words leading-relaxed"
            : "truncate",
          truncate && "truncate",
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors">
        {copied ? (
          <IconCheck className="text-status-online size-3.5" />
        ) : (
          <IconCopy className="size-3.5" />
        )}
      </span>
      {copied && (
        <span
          className={cn(
            // Sit INSIDE the button bounds (no bleed) so a scroll container
            // wrapping the code block can't clip the badge, and so the
            // stacking context never has to fight the surrounding card.
            // z-10 keeps it above the icon + text on the same row.
            "bg-status-online text-background pointer-events-none absolute z-10 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.06em]",
            multiline
              ? "right-8 top-1.5"
              : "right-7 top-1/2 -translate-y-1/2",
          )}
        >
          Copied
        </span>
      )}
    </button>
  )
}
