import { cn } from "@/lib/utils"

export type Status =
  | "online"
  | "active"
  | "degraded"
  | "offline"
  | "paused"
  | "revoked"
  | "pending"

const TONE: Record<Status, string> = {
  online: "bg-status-online/15 text-status-online border-status-online/30",
  active: "bg-status-online/15 text-status-online border-status-online/30",
  degraded:
    "bg-status-degraded/15 text-status-degraded border-status-degraded/30",
  offline: "bg-status-offline/15 text-status-offline border-status-offline/30",
  paused: "bg-status-paused/20 text-foreground/80 border-border",
  revoked: "bg-status-revoked/12 text-status-revoked border-status-revoked/25",
  pending: "bg-muted text-muted-foreground border-border",
}

const LABEL: Record<Status, string> = {
  online: "Online",
  active: "Active",
  degraded: "Degraded",
  offline: "Offline",
  paused: "Paused",
  revoked: "Revoked",
  pending: "Pending",
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
    const dotTone =
      status === "online" || status === "active"
        ? "bg-status-online"
        : status === "degraded"
          ? "bg-status-degraded"
          : status === "revoked"
            ? "bg-status-revoked"
            : status === "paused"
              ? "bg-status-paused"
              : "bg-status-offline"
    return (
      <span
        className={cn(
          "inline-block size-1.5 shrink-0 rounded-full",
          dotTone,
          className,
        )}
        aria-label={label ?? LABEL[status]}
      />
    )
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none transition-colors",
        TONE[status],
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "online" || status === "active"
            ? "bg-status-online"
            : status === "degraded"
              ? "bg-status-degraded"
              : status === "revoked"
                ? "bg-status-revoked"
                : status === "paused"
                  ? "bg-status-paused"
                  : "bg-status-offline",
        )}
      />
      {label ?? LABEL[status]}
    </span>
  )
}
