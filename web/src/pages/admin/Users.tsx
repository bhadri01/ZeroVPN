import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconSearch } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PageHeader } from "@/components/PageHeader"
import { RelativeTime } from "@/components/RelativeTime"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ApiError,
  type AdminUser,
  type UserStatus,
  adminListUsers,
  adminSetUserStatus,
} from "@/lib/api"
import { useAuth } from "@/stores/auth"

const USER_STATUS_TO_PILL: Record<UserStatus, Status> = {
  active: "active",
  suspended: "revoked",
  pending_verification: "pending",
  deleted: "offline",
}

export function UsersPage() {
  const me = useAuth((s) => s.user)
  const qc = useQueryClient()

  const [search, setSearch] = useState("")
  const [suspendTarget, setSuspendTarget] = useState<AdminUser | null>(null)

  const usersQ = useQuery({
    queryKey: ["admin", "users", search],
    queryFn: () => adminListUsers(search || undefined, 200, 0),
  })

  const setStatusM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      adminSetUserStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] })
      setSuspendTarget(null)
      toast.success("User status updated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const items = usersQ.data?.items ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Search, suspend, unsuspend. Bulk operations land in v2."
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <IconSearch className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email…"
                className="pl-8"
              />
            </div>
            <p className="text-muted-foreground text-xs whitespace-nowrap">
              {usersQ.data?.total ?? 0} total
            </p>
          </div>

          {usersQ.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          {usersQ.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>2FA</TableHead>
                  <TableHead className="text-right">Devices</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((u) => {
                  const isSelf = u.id === me?.id
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.email}
                        {isSelf && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            you
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          status={USER_STATUS_TO_PILL[u.status] ?? "pending"}
                          label={u.status.replace(/_/g, " ")}
                        />
                      </TableCell>
                      <TableCell>
                        {u.totp_enabled ? (
                          <Badge variant="outline" className="text-status-online">
                            on
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {u.device_count}
                      </TableCell>
                      <TableCell className="text-xs">
                        <RelativeTime value={u.last_login_at} fallback="Never" />
                      </TableCell>
                      <TableCell className="text-right">
                        {!isSelf && u.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSuspendTarget(u)}
                          >
                            Suspend
                          </Button>
                        )}
                        {!isSelf && u.status === "suspended" && (
                          <Button
                            size="sm"
                            onClick={() =>
                              setStatusM.mutate({ id: u.id, status: "active" })
                            }
                          >
                            Unsuspend
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {!usersQ.isLoading && items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-muted-foreground py-8 text-center"
                    >
                      No users match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!suspendTarget}
        onOpenChange={(o) => !o && setSuspendTarget(null)}
        title={`Suspend ${suspendTarget?.email ?? "user"}?`}
        description="Suspends the account, blocks future logins, and keeps device rows in place. Reversible — Unsuspend brings them back."
        confirmLabel="Suspend"
        destructive
        pending={setStatusM.isPending}
        onConfirm={() =>
          suspendTarget &&
          setStatusM.mutate({ id: suspendTarget.id, status: "suspended" })
        }
      />
    </div>
  )
}
