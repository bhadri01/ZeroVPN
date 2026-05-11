import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { adminListAudit, type AuditRow } from "@/lib/api"
import { useEventTail, type TailLine } from "@/stores/eventTail"
import { useAuth } from "@/stores/auth"

type Tone = "ok" | "warn" | "err" | "info" | "muted"

interface ActivityItem {
  id: string
  tsMs: number
  tone: Tone
  event: string
  target: string
  actor: string
  meta?: string
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function toneForAuditAction(action: string): Tone {
  if (action.includes("failed") || action.includes("revoke") || action.includes("error")) return "err"
  if (action.includes("warn") || action.includes("rotate") || action.includes("suspend")) return "warn"
  if (action.includes("login") || action.includes("create") || action.includes("enable") || action.includes("ok"))
    return "ok"
  return "info"
}

function auditToItem(row: AuditRow): ActivityItem {
  const target =
    row.target_id
      ? `${row.target_type ?? ""}${row.target_type ? "·" : ""}${row.target_id.slice(0, 12)}`
      : (row.target_type ?? "—")
  return {
    id: `a${row.id}`,
    tsMs: new Date(row.created_at).getTime(),
    tone: toneForAuditAction(row.action),
    event: row.action,
    target,
    actor: row.actor_user_id ? row.actor_user_id.slice(0, 8) : "system",
  }
}

function tailToItem(line: TailLine): ActivityItem {
  // `text` already contains a "kind · subject · detail" pattern. Split it
  // back out so the timeline layout matches the design.
  const parts = line.text.split(" · ")
  return {
    id: `t${line.id}`,
    tsMs: line.tsMs,
    tone: line.tone,
    event: parts[0] ?? line.kind,
    target: parts[1] ?? "",
    actor: parts.slice(2).join(" · ") || "live",
  }
}

interface RecentActivityProps {
  /** Cap rows. Mirrors the design's "last 8" footer. */
  limit?: number
}

export function RecentActivity({ limit = 8 }: RecentActivityProps) {
  const user = useAuth((s) => s.user)
  const isAdmin = user?.role === "admin"

  // Admins get real audit rows from the database.
  const auditQ = useQuery({
    queryKey: ["admin", "audit", "dashboard", limit],
    queryFn: () => adminListAudit(limit, 0),
    enabled: isAdmin,
    refetchInterval: 15_000,
  })

  // Non-admins build their own activity feed from the live tail. These are
  // backend-emitted events for THIS user (the WS pipeline filters them at
  // the API layer), not mocks.
  const tail = useEventTail((s) => s.lines)

  const items: ActivityItem[] = isAdmin
    ? (auditQ.data?.items ?? []).map(auditToItem)
    : tail.slice(-limit).reverse().map(tailToItem)

  if (isAdmin && auditQ.isLoading) {
    return (
      <p className="text-muted-foreground px-4 py-3 font-mono text-xs">
        Loading…
      </p>
    )
  }
  if (isAdmin && auditQ.isError) {
    return (
      <p className="text-destructive px-4 py-3 font-mono text-xs">
        Failed to load activity.
      </p>
    )
  }
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-3 font-mono text-xs">
        No activity yet — events appear here as your devices connect.
      </p>
    )
  }

  return (
    <div className="px-4 py-2">
      {items.map((a, i) => (
        <div className="zv-tl-item" key={a.id}>
          <div className="zv-tl-time">{fmtTime(a.tsMs)}</div>
          <div className="zv-tl-rail">
            <div className="zv-tl-dot" data-tone={a.tone} />
            {i < items.length - 1 && <div className="zv-tl-line" />}
          </div>
          <div className="zv-tl-body">
            <div>
              <strong className="font-mono">{a.event}</strong>
              {a.target && (
                <span className="text-muted-foreground"> · {a.target}</span>
              )}
            </div>
            <div className="zv-tl-meta">{a.actor}</div>
          </div>
        </div>
      ))}
      {isAdmin && (
        <div className="text-muted-foreground/70 mt-1 px-1 py-2 font-mono text-[10px]">
          <Link to="/admin/audit" className="hover:text-foreground">
            View full audit log ↗
          </Link>
        </div>
      )}
    </div>
  )
}
