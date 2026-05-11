import { cn } from "@/lib/utils"

import { Pill, type PillTone } from "./swiss"

export type Status =
  | "online"
  | "active"
  | "degraded"
  | "offline"
  | "paused"
  | "revoked"
  | "pending"

const TONE: Record<Status, PillTone> = {
  online: "ok",
  active: "ok",
  degraded: "warn",
  offline: "paused",
  paused: "paused",
  revoked: "err",
  pending: "warn",
}

const LABEL: Record<Status, string> = {
  online: "Live",
  active: "Live",
  degraded: "Degraded",
  offline: "Offline",
  paused: "Paused",
  revoked: "Revoked",
  pending: "Pending",
}

const DOT_BG: Record<Status, string> = {
  online: "bg-status-online",
  active: "bg-status-online",
  degraded: "bg-status-degraded",
  offline: "bg-status-offline",
  paused: "bg-status-paused",
  revoked: "bg-status-revoked",
  pending: "bg-status-degraded",
}

export function StatusPill({
  status,
  label,
  className,
  dotOnly = false,
}: {
  status: Status
  label?: string
  className?: string
  dotOnly?: boolean
}) {
  if (dotOnly) {
    return (
      <span
        className={cn(
          "inline-block size-1.5 shrink-0 rounded-full",
          DOT_BG[status],
          className,
        )}
        aria-label={label ?? LABEL[status]}
      />
    )
  }
  return (
    <Pill tone={TONE[status]} className={className}>
      {label ?? LABEL[status]}
    </Pill>
  )
}
