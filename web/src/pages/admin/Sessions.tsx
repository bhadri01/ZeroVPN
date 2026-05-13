import { useQuery } from "@tanstack/react-query"
import { IconSearch, IconX } from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"

import { CopyableCode } from "@/components/CopyableCode"
import { PageStagger, StaggerItem } from "@/components/motion"
import { Pagination } from "@/components/Pagination"
import { RelativeTime } from "@/components/RelativeTime"
import { Kbd, PageHead, Panel } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type AdminSessionEventFilters,
  type SessionEventKind,
  adminListSessionEvents,
} from "@/lib/api"

type RangeChoice = "all" | "1h" | "24h" | "7d" | "30d"

const RANGE_LABEL: Record<RangeChoice, string> = {
  all: "All time",
  "1h": "Last hour",
  "24h": "Last 24h",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
}

function rangeToSince(r: RangeChoice): string | undefined {
  if (r === "all") return undefined
  const ms =
    r === "1h"
      ? 60 * 60 * 1000
      : r === "24h"
        ? 24 * 60 * 60 * 1000
        : r === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000
  return new Date(Date.now() - ms).toISOString()
}

const EVENT_OPTIONS: { value: "all" | SessionEventKind; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "idle_timeout", label: "Idle timeout" },
  { value: "suspicious_login", label: "Suspicious login" },
  { value: "password_change", label: "Password change" },
  { value: "totp_enable", label: "2FA enable" },
  { value: "totp_disable", label: "2FA disable" },
  { value: "impersonation_start", label: "Impersonation start" },
  { value: "impersonation_end", label: "Impersonation end" },
]

export function SessionsPage() {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  const [eventFilter, setEventFilter] = useState<"all" | SessionEventKind>("all")
  const [userIdFilter, setUserIdFilter] = useState("")
  const [ipFilter, setIpFilter] = useState("")
  const [range, setRange] = useState<RangeChoice>("all")

  useEffect(() => {
    setPage(0)
  }, [eventFilter, userIdFilter, ipFilter, range, pageSize])

  const filters = useMemo<AdminSessionEventFilters>(
    () => ({
      event: eventFilter === "all" ? undefined : eventFilter,
      user_id: userIdFilter.trim() || undefined,
      ip: ipFilter.trim() || undefined,
      since: rangeToSince(range),
    }),
    [eventFilter, userIdFilter, ipFilter, range],
  )

  const filtersActive =
    !!filters.event ||
    !!filters.user_id ||
    !!filters.ip ||
    !!filters.since

  const q = useQuery({
    queryKey: ["admin", "session-events", filters, page, pageSize],
    queryFn: () => adminListSessionEvents(filters, pageSize, page * pageSize),
    placeholderData: (prev) => prev,
  })
  const items = q.data?.items ?? []
  const total = q.data?.total ?? 0

  const clearFilters = () => {
    setEventFilter("all")
    setUserIdFilter("")
    setIpFilter("")
    setRange("all")
  }

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 07"
          title="Sessions"
          sub={`${total.toLocaleString()} events${filtersActive ? " (filtered)" : ""} · login · logout · 2FA · impersonation · suspicious-login`}
        />
      </StaggerItem>

      <StaggerItem>
        <Panel flush>
          <div className="border-border flex flex-wrap items-end gap-2 border-b p-2">
            <FilterField label="Event" htmlFor="sess-event" widthClass="w-44">
              <Select
                value={eventFilter}
                onValueChange={(v) =>
                  setEventFilter(v as "all" | SessionEventKind)
                }
              >
                <SelectTrigger id="sess-event" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="User-id" htmlFor="sess-user" widthClass="w-64">
              <Input
                id="sess-user"
                value={userIdFilter}
                onChange={(e) => setUserIdFilter(e.target.value)}
                placeholder="UUID"
                className="h-8 font-mono text-xs"
              />
            </FilterField>
            <FilterField label="IP" htmlFor="sess-ip" widthClass="w-44">
              <div className="relative">
                <IconSearch className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  id="sess-ip"
                  value={ipFilter}
                  onChange={(e) => setIpFilter(e.target.value)}
                  placeholder="203.0.113.42"
                  className="h-8 pl-8 font-mono text-xs"
                />
              </div>
            </FilterField>
            <FilterField label="Range" htmlFor="sess-range" widthClass="w-36">
              <Select
                value={range}
                onValueChange={(v) => setRange(v as RangeChoice)}
              >
                <SelectTrigger id="sess-range" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RANGE_LABEL) as RangeChoice[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {RANGE_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            {filtersActive && (
              <Button
                size="sm"
                variant="ghost"
                onClick={clearFilters}
                className="h-8 text-xs"
              >
                <IconX className="size-3.5" />
                Clear
              </Button>
            )}
          </div>

          {q.isLoading && (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-8 rounded-none" />
              <Skeleton className="h-8 rounded-none" />
              <Skeleton className="h-8 rounded-none" />
            </div>
          )}
          {q.data && (
            <div className="zv-table-scroll">
              <table className="zv-table">
                <thead>
                  <tr>
                    <th className="w-[180px]">When</th>
                    <th>User</th>
                    <th>Event</th>
                    <th className="w-[140px]">IP</th>
                    <th>User-Agent</th>
                    <th>Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className="text-muted-foreground font-mono text-xs">
                        <RelativeTime value={row.created_at} />
                      </td>
                      <td className="text-muted-foreground font-mono text-xs">
                        <button
                          type="button"
                          onClick={() => setUserIdFilter(row.user_id)}
                          className="hover:text-foreground transition-colors"
                          title="Filter by this user"
                        >
                          {row.user_id.slice(0, 8)}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setEventFilter(row.event)}
                          title="Filter by this event"
                        >
                          <Kbd>{row.event}</Kbd>
                        </button>
                      </td>
                      <td className="font-mono text-xs tabular-nums">
                        {row.ip ? (
                          <button
                            type="button"
                            onClick={() => {
                              const bare = row.ip!.replace(/\/(32|128)$/, "")
                              setIpFilter(bare)
                            }}
                            className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                            title="Filter by this IP"
                          >
                            {row.ip.replace(/\/(32|128)$/, "")}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td
                        className="text-muted-foreground max-w-[240px] truncate font-mono text-[11px]"
                        title={row.user_agent ?? undefined}
                      >
                        {row.user_agent ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="max-w-[280px]">
                        {Object.keys(row.metadata).length > 0 ? (
                          <CopyableCode
                            value={JSON.stringify(row.metadata)}
                            truncate
                          />
                        ) : (
                          <span className="text-muted-foreground font-mono text-[11px]">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-muted-foreground py-8 text-center font-mono text-sm"
                      >
                        {filtersActive
                          ? "No events match the current filters."
                          : "No session events yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            itemCount={items.length}
            fetching={q.isFetching}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </Panel>
      </StaggerItem>
    </PageStagger>
  )
}

function FilterField({
  label,
  htmlFor,
  widthClass,
  children,
}: {
  label: string
  htmlFor: string
  widthClass: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex flex-col gap-1 ${widthClass}`}>
      <label
        htmlFor={htmlFor}
        className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide"
      >
        {label}
      </label>
      {children}
    </div>
  )
}
