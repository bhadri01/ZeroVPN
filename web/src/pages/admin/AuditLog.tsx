import { useQuery } from "@tanstack/react-query"
import { IconDownload } from "@tabler/icons-react"
import { useEffect, useState } from "react"

import { CopyableCode } from "@/components/CopyableCode"
import { PageStagger, StaggerItem } from "@/components/motion"
import { Pagination } from "@/components/Pagination"
import { RelativeTime } from "@/components/RelativeTime"
import { Kbd, PageHead, Panel } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { adminAuditCsvUrl, adminListAudit } from "@/lib/api"

export function AuditLogPage() {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  useEffect(() => {
    setPage(0)
  }, [pageSize])
  const auditQ = useQuery({
    queryKey: ["admin", "audit", page, pageSize],
    queryFn: () => adminListAudit(pageSize, page * pageSize),
    placeholderData: (prev) => prev,
  })
  const items = auditQ.data?.items ?? []
  const total = auditQ.data?.total ?? 0

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 03"
          title="Audit log"
          sub={`${total.toLocaleString()} entries · 180-day retention · CSV export`}
          right={
            <Button asChild variant="outline" size="sm">
              <a href={adminAuditCsvUrl(5000)}>
                <IconDownload />
                Export CSV
              </a>
            </Button>
          }
        />
      </StaggerItem>

      <StaggerItem>
      <Panel flush>
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
                <th className="w-[200px]">When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
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
                    {row.actor_user_id
                      ? row.actor_user_id.slice(0, 8)
                      : "—"}
                  </td>
                  <td>
                    <Kbd>{row.action}</Kbd>
                  </td>
                  <td className="font-mono text-xs">
                    {row.target_type ?? "—"}
                    {row.target_id && (
                      <span className="text-muted-foreground ml-1">
                        · {String(row.target_id).slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[280px]">
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
                    colSpan={5}
                    className="text-muted-foreground py-8 text-center font-mono text-sm"
                  >
                    No audit entries yet.
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
