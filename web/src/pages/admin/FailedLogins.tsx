import { useQuery } from "@tanstack/react-query"

import { PageHeader } from "@/components/PageHeader"
import { RelativeTime } from "@/components/RelativeTime"
import { Badge } from "@/components/ui/badge"
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
import { adminListFailedLogins } from "@/lib/api"

export function FailedLoginsPage() {
  const q = useQuery({
    queryKey: ["admin", "failed-logins"],
    queryFn: () => adminListFailedLogins(200, 0),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Failed logins"
        description="Authentication attempts that didn't succeed in the last 30 days. IPs stored as /24 prefixes only."
      />

      <Card>
        <CardContent>
          {q.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          )}
          {q.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">When</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      <RelativeTime value={row.attempted_at} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.email_attempted ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {row.reason.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {q.data.items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-muted-foreground py-8 text-center"
                    >
                      No failed-login attempts yet.
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
