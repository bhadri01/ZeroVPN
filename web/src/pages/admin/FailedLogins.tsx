import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { useResettingPage } from "@/hooks/useResettingPage"

import { PageStagger, StaggerItem } from "@/components/motion"
import { Pagination } from "@/components/Pagination"
import { RelativeTime } from "@/components/RelativeTime"
import { Kpi, KpiStrip, PageHead, Panel, Pill } from "@/components/swiss"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListFailedLogins } from "@/lib/api"

export function FailedLoginsPage() {
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useResettingPage(String(pageSize))
  const q = useQuery({
    queryKey: ["admin", "failed-logins", page, pageSize],
    queryFn: () => adminListFailedLogins(pageSize, page * pageSize),
    placeholderData: (prev) => prev,
  })

  const items = q.data?.items ?? []
  const total = q.data?.total ?? 0
  // KPI counts are computed from the current page only, since we don't
  // have a server-side breakdown by reason. Labels reflect that scope so
  // the numbers don't pretend to be deployment-wide aggregates.
  const rateLimited = items.filter((i) => i.reason === "rate_limited").length
  const totpBad = items.filter((i) => i.reason === "totp_incorrect").length
  const noUser = items.filter((i) => i.reason === "no_such_user").length

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 04"
          title="Failed logins"
          sub="brute-force mitigation · rate-limit at 5/15min/email · full IP + UA retained"
        />
      </StaggerItem>

      <StaggerItem>
        <KpiStrip>
          <Kpi
            label="Failed · total"
            value={total}
            footL="all retained attempts"
            deltaTone={total > 0 ? "dn" : undefined}
          />
          <Kpi
            label="Rate-limited · page"
            value={rateLimited}
            footL="auto-expire 1h"
          />
          <Kpi
            label="TOTP wrong · page"
            value={totpBad}
            footL="invalid 2FA code"
          />
          <Kpi
            label="No-such-user · page"
            value={noUser}
            footL="email not in DB"
          />
        </KpiStrip>
      </StaggerItem>

      <StaggerItem>
        <Panel
          title="Recent failures"
          sub={`${total.toLocaleString()} retained · newest first`}
          flush
        >
          {q.isLoading && (
            <div className="flex flex-col gap-2 p-4">
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
                    <th>Email</th>
                    <th className="hidden sm:table-cell">Reason</th>
                    <th className="hidden w-[150px] md:table-cell">IP</th>
                    <th className="hidden lg:table-cell">User-Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono text-xs text-muted-foreground">
                        <RelativeTime value={row.attempted_at} />
                      </td>
                      <td className="font-mono text-xs">
                        {row.email_attempted ?? (
                          <span className="text-muted-foreground">
                            (no user)
                          </span>
                        )}
                      </td>
                      <td className="hidden sm:table-cell">
                        {reasonPill(row.reason)}
                      </td>
                      <td className="hidden font-mono text-xs tabular-nums md:table-cell">
                        {row.ip ? (
                          // Strip the `/32` or `/128` suffix for the table cell
                          // — the column type is INET so the API returns
                          // "203.0.113.42/32" but the suffix is noise here.
                          row.ip.replace(/\/(32|128)$/, "")
                        ) : (
                          <span className="text-muted-foreground">
                            (unknown)
                          </span>
                        )}
                      </td>
                      <td
                        className="hidden max-w-[420px] truncate font-mono text-[11px] text-muted-foreground lg:table-cell"
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
                        colSpan={5}
                        className="py-8 text-center font-mono text-sm text-muted-foreground"
                      >
                        No failed-login attempts yet.
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

function reasonPill(reason: string) {
  if (reason === "rate_limited")
    return (
      <Pill tone="err" dot={false}>
        rate-limited
      </Pill>
    )
  if (reason === "totp_incorrect")
    return (
      <Pill tone="warn" dot={false}>
        totp
      </Pill>
    )
  if (reason === "no_such_user")
    return (
      <Pill tone="info" dot={false}>
        no-user
      </Pill>
    )
  return (
    <Pill tone="warn" dot={false}>
      {reason.replace(/_/g, "-")}
    </Pill>
  )
}
