import { useQuery } from "@tanstack/react-query"
import { IconSearch, IconX } from "@tabler/icons-react"
import { useMemo, useState } from "react"

import { useResettingPage } from "@/hooks/useResettingPage"

import { PageStagger, StaggerItem } from "@/components/motion"
import { Pagination } from "@/components/Pagination"
import { RelativeTime } from "@/components/RelativeTime"
import { Kbd, PageHead, Panel, Pill, type PillTone } from "@/components/swiss"
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
import { type AdminAccessLogFilters, adminListAccessLogs } from "@/lib/api"

type RangeChoice = "1h" | "24h" | "7d" | "30d" | "all"
type StatusChoice = "all" | "2xx" | "3xx" | "4xx" | "5xx" | "non2xx"
type MethodChoice = "all" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

const RANGE_LABEL: Record<RangeChoice, string> = {
  "1h": "Last hour",
  "24h": "Last 24h",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
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

function statusBand(s: StatusChoice): { min?: number; max?: number } {
  switch (s) {
    case "2xx":
      return { min: 200, max: 299 }
    case "3xx":
      return { min: 300, max: 399 }
    case "4xx":
      return { min: 400, max: 499 }
    case "5xx":
      return { min: 500, max: 599 }
    case "non2xx":
      // "non-success" = anything that didn't land in 2xx. Server-side
      // status_min handles the lower bound; we leave status_max at 199
      // and rely on the fact that status_min > status_max would match
      // nothing — so instead, request rows with status >= 300.
      return { min: 300 }
    default:
      return {}
  }
}

const STATUS_OPTIONS: { value: StatusChoice; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "2xx", label: "2xx · success" },
  { value: "3xx", label: "3xx · redirect" },
  { value: "4xx", label: "4xx · client error" },
  { value: "5xx", label: "5xx · server error" },
  { value: "non2xx", label: "Any non-2xx" },
]

const METHOD_OPTIONS: { value: MethodChoice; label: string }[] = [
  { value: "all", label: "All methods" },
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
  { value: "DELETE", label: "DELETE" },
]

function toneForStatus(status: number): PillTone {
  if (status >= 500) return "err"
  if (status >= 400) return "warn"
  if (status >= 300) return "info"
  return "ok"
}

export function AccessLogsPage() {
  const [pageSize, setPageSize] = useState(50)

  const [methodFilter, setMethodFilter] = useState<MethodChoice>("all")
  const [statusFilter, setStatusFilter] = useState<StatusChoice>("all")
  const [pathFilter, setPathFilter] = useState("")
  const [userIdFilter, setUserIdFilter] = useState("")
  const [ipFilter, setIpFilter] = useState("")
  const [range, setRange] = useState<RangeChoice>("1h")

  const [page, setPage] = useResettingPage(
    JSON.stringify([
      methodFilter,
      statusFilter,
      pathFilter,
      userIdFilter,
      ipFilter,
      range,
      pageSize,
    ])
  )

  const filters = useMemo<AdminAccessLogFilters>(() => {
    const sb = statusBand(statusFilter)
    return {
      method: methodFilter === "all" ? undefined : methodFilter,
      path: pathFilter.trim() || undefined,
      user_id: userIdFilter.trim() || undefined,
      ip: ipFilter.trim() || undefined,
      since: rangeToSince(range),
      status_min: sb.min,
      status_max: sb.max,
    }
  }, [methodFilter, statusFilter, pathFilter, userIdFilter, ipFilter, range])

  const filtersActive =
    methodFilter !== "all" ||
    statusFilter !== "all" ||
    !!filters.path ||
    !!filters.user_id ||
    !!filters.ip ||
    range !== "all"

  const q = useQuery({
    queryKey: ["admin", "access-logs", filters, page, pageSize],
    queryFn: () => adminListAccessLogs(filters, pageSize, page * pageSize),
    placeholderData: (prev) => prev,
    // High-cardinality table — keep results fresh-ish without hammering.
    refetchInterval: 15_000,
  })
  const items = q.data?.items ?? []
  const total = q.data?.total ?? 0

  const clearFilters = () => {
    setMethodFilter("all")
    setStatusFilter("all")
    setPathFilter("")
    setUserIdFilter("")
    setIpFilter("")
    setRange("1h")
  }

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 08"
          title="Access logs"
          sub={`${total.toLocaleString()} requests${filtersActive ? " (filtered)" : ""} · per-request method · path · status · latency · IP · UA`}
        />
      </StaggerItem>

      <StaggerItem>
        <Panel flush>
          <div className="flex flex-wrap items-end gap-2 border-b border-border p-2">
            <FilterField label="Method" htmlFor="ax-method" widthClass="w-36">
              <Select
                value={methodFilter}
                onValueChange={(v) => setMethodFilter(v as MethodChoice)}
              >
                <SelectTrigger id="ax-method" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Status" htmlFor="ax-status" widthClass="w-44">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusChoice)}
              >
                <SelectTrigger id="ax-status" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Path" htmlFor="ax-path" widthClass="w-56">
              <div className="relative">
                <IconSearch className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="ax-path"
                  value={pathFilter}
                  onChange={(e) => setPathFilter(e.target.value)}
                  placeholder="/api/v1/admin"
                  className="h-8 pl-8 font-mono text-xs"
                />
              </div>
            </FilterField>
            <FilterField label="User-id" htmlFor="ax-user" widthClass="w-56">
              <Input
                id="ax-user"
                value={userIdFilter}
                onChange={(e) => setUserIdFilter(e.target.value)}
                placeholder="UUID"
                className="h-8 font-mono text-xs"
              />
            </FilterField>
            <FilterField label="IP" htmlFor="ax-ip" widthClass="w-44">
              <Input
                id="ax-ip"
                value={ipFilter}
                onChange={(e) => setIpFilter(e.target.value)}
                placeholder="203.0.113.42"
                className="h-8 font-mono text-xs"
              />
            </FilterField>
            <FilterField label="Range" htmlFor="ax-range" widthClass="w-36">
              <Select
                value={range}
                onValueChange={(v) => setRange(v as RangeChoice)}
              >
                <SelectTrigger id="ax-range" className="h-8 text-xs">
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
                    <th className="w-[150px]">When</th>
                    <th className="hidden w-[70px] sm:table-cell">Method</th>
                    <th>Path</th>
                    <th className="w-[80px]">Status</th>
                    <th className="hidden w-[80px] text-right md:table-cell">
                      Latency
                    </th>
                    <th className="hidden md:table-cell">User</th>
                    <th className="hidden w-[140px] lg:table-cell">IP</th>
                    <th className="hidden lg:table-cell">User-Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono text-xs text-muted-foreground">
                        <RelativeTime value={row.created_at} />
                      </td>
                      <td className="hidden sm:table-cell">
                        <button
                          type="button"
                          onClick={() =>
                            setMethodFilter(row.method as MethodChoice)
                          }
                          title="Filter by this method"
                        >
                          <Kbd>{row.method}</Kbd>
                        </button>
                      </td>
                      <td
                        className="max-w-[420px] truncate font-mono text-xs"
                        title={row.path}
                      >
                        <button
                          type="button"
                          onClick={() => setPathFilter(row.path)}
                          className="underline-offset-2 hover:text-foreground hover:underline"
                          title="Filter by this path prefix"
                        >
                          {row.path}
                        </button>
                      </td>
                      <td>
                        <Pill tone={toneForStatus(row.status)} dot={false}>
                          {row.status}
                        </Pill>
                      </td>
                      <td className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums md:table-cell">
                        {row.latency_ms} ms
                      </td>
                      <td className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                        {row.user_id ? (
                          <button
                            type="button"
                            onClick={() => setUserIdFilter(row.user_id!)}
                            className="transition-colors hover:text-foreground"
                            title="Filter by this user"
                          >
                            {row.user_id.slice(0, 8)}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="hidden font-mono text-xs tabular-nums lg:table-cell">
                        {row.ip ? (
                          <button
                            type="button"
                            onClick={() => {
                              const bare = row.ip!.replace(/\/(32|128)$/, "")
                              setIpFilter(bare)
                            }}
                            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            title="Filter by this IP"
                          >
                            {row.ip.replace(/\/(32|128)$/, "")}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td
                        className="hidden max-w-[260px] truncate font-mono text-[11px] text-muted-foreground lg:table-cell"
                        title={row.user_agent ?? undefined}
                      >
                        {row.user_agent ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center font-mono text-sm text-muted-foreground"
                      >
                        {filtersActive
                          ? "No requests match the current filters."
                          : "No access logs yet."}
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
        className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  )
}
