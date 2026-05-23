import { IconCheck, IconCopy } from "@tabler/icons-react"
import { useCallback, useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * Tiny inline copy-to-clipboard icon button. Shows a check for ~1.2s after
 * a copy. Stops click propagation + default so it can sit next to (or
 * inside a row with) a `<Link>` / clickable card without triggering
 * navigation. For full-width "click anywhere to copy" blocks use
 * `CopyableCode` instead.
 */
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(value)
        setCopied(true)
      } catch {
        /* clipboard blocked — no-op */
      }
    },
    [value],
  )

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label}
      title={copied ? "Copied" : label}
      className={cn(
        "text-muted-foreground/40 hover:text-foreground shrink-0 transition-colors",
        className,
      )}
    >
      {copied ? (
        <IconCheck className="text-status-online size-3" />
      ) : (
        <IconCopy className="size-3" />
      )}
    </button>
  )
}
