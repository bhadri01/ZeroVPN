import { useQuery } from "@tanstack/react-query"
import { IconDownload } from "@tabler/icons-react"

import { CopyableCode } from "@/components/CopyableCode"
import { PageHeader } from "@/components/PageHeader"
import { RelativeTime } from "@/components/RelativeTime"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { adminAuditCsvUrl, adminListAudit } from "@/lib/api"

export function AuditLogPage() {
  const auditQ = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => adminListAudit(200, 0),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every administrative action with actor, target, and IP prefix."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={adminAuditCsvUrl(5000)}>
              <IconDownload />
              Export CSV
            </a>
          </Button>
        }
      />

      <Card>
        <CardContent>
          {auditQ.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          )}
          {auditQ.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditQ.data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                      <RelativeTime value={row.created_at} />
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {row.actor_user_id
                        ? row.actor_user_id.slice(0, 8)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {row.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.target_type ?? "—"}
                      {row.target_id && (
                        <span className="text-muted-foreground ml-1 font-mono">
                          {String(row.target_id).slice(0, 8)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <CopyableCode
                        value={JSON.stringify(row.metadata)}
                        truncate
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {auditQ.data.items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-muted-foreground py-8 text-center"
                    >
                      No audit entries yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
