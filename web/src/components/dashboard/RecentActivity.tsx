import { useQuery } from "@tanstack/react-query"
import { IconActivity, IconArrowUpRight } from "@tabler/icons-react"
import { Link } from "react-router"

import { adminListAudit, type AuditRow } from "@/lib/api"
import { formatTime } from "@/lib/datetime"
import { Skeleton } from "@/components/ui/skeleton"
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
}

/** Render HH:MM. Returns "—" when the timestamp is missing or garbage so
 *  the cell never displays "Invalid Date". */
function fmtTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—"
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return "—"
  return formatTime(d)
}

/** Compact relative-time string. Guards against NaN / undefined so the
 *  cell never displays "NaNd ago". */
function fmtRelativeShort(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—"
  const diff = Date.now() - ms
  if (!Number.isFinite(diff)) return "—"
  if (diff < 0) return "just now"
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

/** Safely turn a backend timestamp (ISO string, number, or anything
 *  else) into milliseconds. Returns 0 when unparseable so the UI's
 *  numeric guards above kick in and render "—". */
function tsToMs(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const t = Date.parse(value)
    return Number.isNaN(t) ? 0 : t
  }
  return 0
}

function toneForAuditAction(action: string): Tone {
  if (action.includes("failed") || action.includes("revoke") || action.includes("error")) return "err"
  if (action.includes("warn") || action.includes("rotate") || action.includes("suspend")) return "warn"
  if (action.includes("login") || action.includes("create") || action.includes("enable") || action.includes("ok"))
    return "ok"
  return "info"
}

function auditToItem(row: AuditRow): ActivityItem {
  const target = row.target_id
    ? `${row.target_type ? row.target_type + " · " : ""}${row.target_id.slice(0, 12)}`
    : (row.target_type ?? "—")
  return {
    id: `a${row.id}`,
    tsMs: tsToMs(row.created_at),
    tone: toneForAuditAction(row.action),
    event: row.action,
    target,
    actor: row.actor_user_id ? row.actor_user_id.slice(0, 8) : "system",
  }
}

function tailToItem(line: TailLine): ActivityItem {
  // `text` is "kind · subject · detail" — split back into the three
  // visible slots so the layout reads consistently with the audit path.
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

/** Fixed-height scrollable shell for the panel. Declared at module scope
 *  (not inside RecentActivity) so React reconciles the same DOM node
 *  across re-renders — otherwise every live-tail update would create a
 *  new component identity, unmount the scrollable div, and reset the
 *  user's scroll back to the top. */
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="h-[420px] overflow-y-auto">{children}</div>
}

export function RecentActivity({ limit = 8 }: RecentActivityProps) {
  const user = useAuth((s) => s.user)
  const isAdmin = user?.role === "admin"

  const auditQ = useQuery({
    queryKey: ["admin", "audit", "dashboard", limit],
    queryFn: () => adminListAudit({}, limit, 0),
    enabled: isAdmin,
    refetchInterval: 15_000,
  })

  const tail = useEventTail((s) => s.lines)
  // For regular users, the tail also carries server-level signals
  // (`server_health` for the sidebar, `server_sample` for admins) that
  // aren't *their* activity. Drop those before slicing so the panel
  // only reflects events tied to the viewer's own devices.
  const userTail = tail.filter(
    (l) => l.kind !== "server_health" && l.kind !== "server_sample",
  )
  const items: ActivityItem[] = isAdmin
    ? (auditQ.data?.items ?? []).map(auditToItem)
    : userTail.slice(-limit).reverse().map(tailToItem)

  // Footer link only for regular users: their preview above is the ephemeral
  // live tail, so the persisted full log must stay reachable even when the
  // preview is empty. Admins reach the full audit log via the card's top-right
  // "View all" action, so the footer would just duplicate it — omit it there.
  const viewAllFooter = isAdmin ? null : (
    <div className="border-border bg-card/70 sticky bottom-0 border-t px-4 py-2">
      <Link
        to="/app/activity"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-mono text-[11px]"
      >
        View all activity
        <IconArrowUpRight size={12} aria-hidden />
      </Link>
    </div>
  )

  if (isAdmin && auditQ.isLoading) {
    return (
      <Shell>
        <div className="flex flex-col gap-2 px-4 py-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-none" />
          ))}
        </div>
      </Shell>
    )
  }
  if (isAdmin && auditQ.isError) {
    return (
      <Shell>
        <p className="text-destructive px-4 py-3 font-mono text-xs">
          Failed to load activity.
        </p>
      </Shell>
    )
  }
  if (items.length === 0) {
    return (
      <Shell>
        <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <IconActivity
            size={20}
            className="text-muted-foreground/40"
            aria-hidden
          />
          <p className="font-mono text-xs leading-relaxed">
            No activity yet — events appear here as devices connect or
            change state.
          </p>
        </div>
        {viewAllFooter}
      </Shell>
    )
  }

  return (
    <Shell>
      <ul className="divide-border divide-y">
        {items.map((a) => (
          <ActivityRow key={a.id} item={a} />
        ))}
      </ul>
      {viewAllFooter}
    </Shell>
  )
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <li className="hover:bg-muted/50 group flex items-start gap-3 px-4 py-2.5 transition-colors">
      <span
        className="zv-act-dot mt-1.5 shrink-0"
        data-tone={item.tone}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-[12px] font-medium tracking-tight"
            data-tone={item.tone}
            // Bold the event verb in its tone so the eye lands on what
            // happened, not on the timestamp.
            style={{ color: `var(--zv-act-${item.tone})` }}
          >
            {item.event}
          </span>
          {item.target && (
            <span className="text-muted-foreground min-w-0 truncate font-mono text-[11px]">
              {item.target}
            </span>
          )}
        </div>
        <div className="text-muted-foreground/80 mt-0.5 flex items-center gap-2 font-mono text-[10px]">
          <span>{fmtTime(item.tsMs)}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{fmtRelativeShort(item.tsMs)}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="truncate">{item.actor}</span>
        </div>
      </div>
    </li>
  )
}
