import { useQuery } from "@tanstack/react-query"
import {
  IconChevronRight,
  IconClipboardList,
  IconDeviceDesktop,
  IconLogin2,
  IconNetwork,
  IconRoute,
  IconSearch,
  IconUserSearch,
  IconX,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Link } from "react-router"

import { PageStagger, StaggerItem } from "@/components/motion"
import { Kbd, PageHead, Panel, Pill } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type FinderResponse,
  type FinderUserMatch,
  type FinderDeviceMatch,
  adminFinder,
} from "@/lib/api"

/**
 * Admin Finder — paste an IP, a WG `host:port` endpoint, an email, a
 * device name, or a User-Agent fragment. The backend detects what you
 * gave it, runs targeted COUNT queries across every relevant log
 * table, and returns a small set of direct matches (users / devices)
 * plus per-table counts that deep-link into the filtered pages.
 *
 * Phase 2 / Stage B — last item in the per-user logging stack.
 */
export function FinderPage() {
  const [input, setInput] = useState("")
  const [committed, setCommitted] = useState("")

  // Empty committed = no fetch. Page renders a help card instead.
  const q = useQuery({
    queryKey: ["admin", "finder", committed],
    queryFn: () => adminFinder(committed),
    enabled: committed.length > 0,
    placeholderData: (prev) => prev,
  })

  // Submit-on-Enter or button click; explicit so a slow query / typo
  // doesn't fire on every keystroke.
  const submit = () => {
    const v = input.trim()
    if (v.length === 0) {
      setCommitted("")
      return
    }
    setCommitted(v)
  }

  // Clear the input + the committed query together so the help card
  // comes back.
  const clear = () => {
    setInput("")
    setCommitted("")
  }

  // Keep input synced with committed when the URL changes externally —
  // not used yet, but cheap to wire so future "shareable result URLs"
  // (?q=…) just need the search-params plumbing.
  useEffect(() => {
    if (committed && committed !== input) setInput(committed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed])

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · Finder"
          title="Cross-source search"
          sub="IP · endpoint · email · device name · User-Agent — admins click a count to pivot into the matching log page with the filter pre-applied"
        />
      </StaggerItem>

      <StaggerItem>
        <Panel flush>
          <div className="border-border flex items-center gap-2 border-b p-2">
            <div className="relative flex-1">
              <IconSearch className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit()
                }}
                placeholder="203.0.113.42 · 203.0.113.42:51820 · curl/8 · alice@example.com · laptop-pro"
                className="h-9 pl-9 font-mono text-sm"
                autoFocus
              />
            </div>
            {input && (
              <Button size="sm" variant="ghost" onClick={clear} title="Clear">
                <IconX className="size-3.5" />
              </Button>
            )}
            <Button size="sm" onClick={submit} disabled={input.trim().length === 0}>
              Search
            </Button>
          </div>

          {committed === "" && <FinderHelp />}
          {committed !== "" && q.isLoading && !q.data && (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-8 rounded-none" />
              <Skeleton className="h-8 rounded-none" />
              <Skeleton className="h-8 rounded-none" />
            </div>
          )}
          {committed !== "" && q.isError && (
            <div className="text-destructive p-6 font-mono text-sm">
              Search failed:{" "}
              {q.error instanceof Error ? q.error.message : "unknown error"}
            </div>
          )}
          {committed !== "" && q.data && <FinderResults data={q.data} />}
        </Panel>
      </StaggerItem>
    </PageStagger>
  )
}

function FinderHelp() {
  return (
    <div className="text-muted-foreground space-y-2 p-6 font-mono text-[12px] leading-relaxed">
      <p className="text-foreground">Examples:</p>
      <ul className="space-y-1.5">
        <li>
          <Kbd>203.0.113.42</Kbd> — every audit / failed-login / session /
          access-log row that touched that IP, plus any device that connected
          from it.
        </li>
        <li>
          <Kbd>203.0.113.42:51820</Kbd> — exact WG `host:port` lookup against
          the peer endpoint history.
        </li>
        <li>
          <Kbd>alice@example.com</Kbd> — substring email match. Returns up to
          10 users.
        </li>
        <li>
          <Kbd>laptop-pro</Kbd> — substring device name match.
        </li>
        <li>
          <Kbd>curl/8</Kbd> · <Kbd>python-requests</Kbd> — User-Agent
          substring across audit / failed-login / session / access-log
          tables.
        </li>
      </ul>
    </div>
  )
}

function FinderResults({ data }: { data: FinderResponse }) {
  const { kind, query, counts, users, devices } = data
  const anyCount =
    counts.audit_logs +
      counts.failed_logins +
      counts.session_events +
      counts.access_logs +
      counts.peer_endpoint_history +
      counts.connection_sessions >
    0
  const anyMatch = users.length + devices.length > 0
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2 font-mono text-[11px]">
        <span className="text-muted-foreground">Detected as</span>
        <Pill tone="info" dot={false}>
          {kind}
        </Pill>
        <span className="text-muted-foreground">for</span>
        <span className="text-foreground">{query}</span>
      </div>

      {!anyCount && !anyMatch && (
        <div className="text-muted-foreground py-8 text-center font-mono text-sm">
          Nothing matched. Try a partial value (email substring, UA
          fragment) or a different shape (full <code>host:port</code> vs.
          bare IP).
        </div>
      )}

      {anyCount && (
        <div>
          <h3 className="zv-eyebrow mb-2">Log counts</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <CountCard
              icon={IconClipboardList}
              label="Audit"
              count={counts.audit_logs}
              link={linkForAudit(kind, query)}
            />
            <CountCard
              icon={IconLogin2}
              label="Sessions"
              count={counts.session_events}
              link={linkForSessionEvents(kind, query)}
            />
            <CountCard
              icon={IconRoute}
              label="Access logs"
              count={counts.access_logs}
              link={linkForAccessLogs(kind, query)}
            />
            <CountCard
              icon={IconUserSearch}
              label="Failed logins"
              count={counts.failed_logins}
              link="/admin/failed-logins"
            />
            <CountCard
              icon={IconNetwork}
              label="Peer endpoints"
              count={counts.peer_endpoint_history}
              link={null}
            />
            <CountCard
              icon={IconNetwork}
              label="Connections"
              count={counts.connection_sessions}
              link={null}
            />
          </div>
        </div>
      )}

      {users.length > 0 && (
        <div>
          <h3 className="zv-eyebrow mb-2">User matches</h3>
          <div className="border-border divide-border flex flex-col divide-y border">
            {users.map((u) => (
              <UserMatchRow key={u.id} u={u} />
            ))}
          </div>
        </div>
      )}

      {devices.length > 0 && (
        <div>
          <h3 className="zv-eyebrow mb-2">Device matches</h3>
          <div className="border-border divide-border flex flex-col divide-y border">
            {devices.map((d) => (
              <DeviceMatchRow key={d.id} d={d} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CountCard({
  icon: Icon,
  label,
  count,
  link,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  link: string | null
}) {
  const inner = (
    <div className="border-border bg-card hover:border-foreground/40 group flex h-full flex-col gap-1 border p-3 transition">
      <div className="text-muted-foreground flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.08em]">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5" />
          {label}
        </span>
        {link && (
          <IconChevronRight className="text-muted-foreground group-hover:text-foreground size-3.5" />
        )}
      </div>
      <div className="text-foreground font-heading text-2xl tabular-nums">
        {count.toLocaleString()}
      </div>
    </div>
  )
  if (link && count > 0) {
    return (
      <Link to={link} title={`Open ${label} filtered to this query`}>
        {inner}
      </Link>
    )
  }
  return inner
}

function UserMatchRow({ u }: { u: FinderUserMatch }) {
  return (
    <Link
      to={`/admin/users/${u.id}`}
      className="hover:bg-muted/40 flex items-center justify-between gap-3 px-3 py-2 transition"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-sm">{u.email}</span>
        <span className="text-muted-foreground font-mono text-[10px]">
          {u.id.slice(0, 8)} · matched on {u.matched_on}
        </span>
      </div>
      <IconChevronRight className="text-muted-foreground size-4" />
    </Link>
  )
}

function DeviceMatchRow({ d }: { d: FinderDeviceMatch }) {
  return (
    <Link
      to={`/admin/devices/${d.id}`}
      className="hover:bg-muted/40 flex items-center justify-between gap-3 px-3 py-2 transition"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="inline-flex items-center gap-2 font-mono text-sm">
          <IconDeviceDesktop className="text-muted-foreground size-3.5" />
          {d.name}
          <span className="text-muted-foreground text-xs">
            · {d.allocated_ip}
          </span>
        </span>
        <span className="text-muted-foreground truncate font-mono text-[10px]">
          {d.last_peer_endpoint
            ? `last endpoint ${d.last_peer_endpoint} · `
            : ""}
          matched on {d.matched_on}
        </span>
      </div>
      <IconChevronRight className="text-muted-foreground size-4" />
    </Link>
  )
}

// Deep-link builders. The target pages already accept `ip` / `path` /
// `user_agent` query params (see Audit + Sessions + AccessLogs).
function linkForAudit(kind: string, q: string): string | null {
  if (kind === "ip") return `/admin/audit?ip=${encodeURIComponent(q)}`
  // Audit page doesn't accept a UA filter yet; surface the count as a
  // hint and let the admin pivot manually. Returning null here makes
  // the CountCard a non-clickable info tile.
  return null
}

function linkForSessionEvents(kind: string, q: string): string | null {
  if (kind === "ip") return `/admin/sessions?ip=${encodeURIComponent(q)}`
  return null
}

function linkForAccessLogs(kind: string, q: string): string | null {
  if (kind === "ip") return `/admin/access-logs?ip=${encodeURIComponent(q)}`
  return null
}
