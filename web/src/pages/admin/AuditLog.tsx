import { useQuery } from "@tanstack/react-query"
import { IconDownload, IconSearch, IconX } from "@tabler/icons-react"
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
  type AdminAuditFilters,
  adminAuditCsvUrl,
  adminListAudit,
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

const TARGET_TYPE_OPTIONS = [
  { value: "all", label: "All targets" },
  { value: "user", label: "User" },
  { value: "device", label: "Device" },
  { value: "server", label: "Server" },
]

export function AuditLogPage() {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  const [actionFilter, setActionFilter] = useState("")
  const [actorIdFilter, setActorIdFilter] = useState("")
  const [targetIdFilter, setTargetIdFilter] = useState("")
  const [targetType, setTargetType] = useState<string>("all")
  const [range, setRange] = useState<RangeChoice>("all")

  // Reset to page 0 whenever a filter changes — pagination cursor on
  // the unfiltered set isn't meaningful for the filtered one.
  useEffect(() => {
    setPage(0)
  }, [actionFilter, actorIdFilter, targetIdFilter, targetType, range, pageSize])

  const filters = useMemo<AdminAuditFilters>(
    () => ({
      action: actionFilter.trim() || undefined,
      actor_user_id: actorIdFilter.trim() || undefined,
      target_id: targetIdFilter.trim() || undefined,
      target_type: targetType === "all" ? undefined : targetType,
      since: rangeToSince(range),
    }),
    [actionFilter, actorIdFilter, targetIdFilter, targetType, range],
  )

  const filtersActive =
    !!filters.action ||
    !!filters.actor_user_id ||
    !!filters.target_id ||
    !!filters.target_type ||
    !!filters.since

  const auditQ = useQuery({
    queryKey: ["admin", "audit", filters, page, pageSize],
    queryFn: () => adminListAudit(filters, pageSize, page * pageSize),
    placeholderData: (prev) => prev,
  })
  const items = auditQ.data?.items ?? []
  const total = auditQ.data?.total ?? 0

  const clearFilters = () => {
    setActionFilter("")
    setActorIdFilter("")
    setTargetIdFilter("")
    setTargetType("all")
    setRange("all")
  }

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 03"
          title="Audit log"
          sub={`${total.toLocaleString()} entries${filtersActive ? " (filtered)" : ""} · retained per policy (30d default) · IP + UA captured · CSV export honors filters`}
          right={
            <Button asChild variant="outline" size="sm">
              <a href={adminAuditCsvUrl(filters, 5000)} download="audit.csv">
                <IconDownload />
                Export CSV
              </a>
            </Button>
          }
        />
      </StaggerItem>

      <StaggerItem>
        <Panel flush>
          <div className="border-border flex flex-wrap items-end gap-2 border-b p-2">
            <FilterField label="Action" htmlFor="audit-action" widthClass="w-56">
              <div className="relative">
                <IconSearch className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  id="audit-action"
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  placeholder="e.g. admin.user_deleted"
                  className="h-8 pl-8 font-mono text-xs"
                />
              </div>
            </FilterField>
            <FilterField label="Actor user-id" htmlFor="audit-actor" widthClass="w-64">
              <Input
                id="audit-actor"
                value={actorIdFilter}
                onChange={(e) => setActorIdFilter(e.target.value)}
                placeholder="UUID prefix or full"
                className="h-8 font-mono text-xs"
              />
            </FilterField>
            <FilterField label="Target id" htmlFor="audit-target" widthClass="w-64">
              <Input
                id="audit-target"
                value={targetIdFilter}
                onChange={(e) => setTargetIdFilter(e.target.value)}
                placeholder="UUID"
                className="h-8 font-mono text-xs"
              />
            </FilterField>
            <FilterField label="Target type" htmlFor="audit-tt" widthClass="w-36">
              <Select
                value={targetType}
                onValueChange={setTargetType}
              >
                <SelectTrigger id="audit-tt" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Range" htmlFor="audit-range" widthClass="w-36">
              <Select
                value={range}
                onValueChange={(v) => setRange(v as RangeChoice)}
              >
                <SelectTrigger id="audit-range" className="h-8 text-xs">
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

          {auditQ.isLoading && (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-8 rounded-none" />
              <Skeleton className="h-8 rounded-none" />
              <Skeleton className="h-8 rounded-none" />
            </div>
          )}
          {auditQ.data && (
            <div className="zv-table-scroll">
              <table className="zv-table">
                <thead>
                  <tr>
                    <th className="w-[180px]">When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th className="hidden md:table-cell">Target</th>
                    <th className="hidden w-[140px] lg:table-cell">IP</th>
                    <th className="hidden lg:table-cell">User-Agent</th>
                    <th className="hidden md:table-cell">Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className="text-muted-foreground font-mono text-xs">
                        <RelativeTime value={row.created_at} />
                      </td>
                      <td className="text-muted-foreground font-mono text-xs">
                        {row.actor_user_id ? (
                          <button
                            type="button"
                            onClick={() => setActorIdFilter(row.actor_user_id!)}
                            className="hover:text-foreground transition-colors"
                            title="Filter by this actor"
                          >
                            {row.actor_user_id.slice(0, 8)}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setActionFilter(row.action)}
                          title="Filter by this action"
                        >
                          <Kbd>{row.action}</Kbd>
                        </button>
                      </td>
                      <td className="hidden font-mono text-xs md:table-cell">
                        {row.target_type ?? "—"}
                        {row.target_id && (
                          <button
                            type="button"
                            onClick={() => setTargetIdFilter(row.target_id!)}
                            className="text-muted-foreground hover:text-foreground ml-1 transition-colors"
                            title="Filter by this target"
                          >
                            · {String(row.target_id).slice(0, 8)}
                          </button>
                        )}
                      </td>
                      <td className="hidden font-mono text-xs tabular-nums lg:table-cell">
                        {row.ip ? (
                          row.ip.replace(/\/(32|128)$/, "")
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td
                        className="text-muted-foreground hidden max-w-[260px] truncate font-mono text-[11px] lg:table-cell"
                        title={row.user_agent ?? undefined}
                      >
                        {row.user_agent ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="hidden max-w-[280px] md:table-cell">
                        <CopyableCode
                          value={JSON.stringify(row.metadata)}
                          truncate
                        />
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="text-muted-foreground py-8 text-center font-mono text-sm"
                      >
                        {filtersActive
                          ? "No entries match the current filters."
                          : "No audit entries yet."}
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
            fetching={auditQ.isFetching}
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
