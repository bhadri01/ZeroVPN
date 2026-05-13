import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconSearch } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Identicon } from "@/components/Identicon"
import { PageStagger, StaggerItem } from "@/components/motion"
import { Pagination } from "@/components/Pagination"
import { RelativeTime } from "@/components/RelativeTime"
import { PageHead, Panel, Pill } from "@/components/swiss"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ApiError,
  type AdminUser,
  type UserStatus,
  adminImpersonateUser,
  adminListUsers,
  adminSetUserStatus,
  me,
} from "@/lib/api"
import { useAuth } from "@/stores/auth"

const USER_STATUS_TO_PILL: Record<UserStatus, Status> = {
  active: "active",
  suspended: "revoked",
  pending_verification: "pending",
  deleted: "offline",
}

export function UsersPage() {
  const self = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [search, setSearch] = useState("")
  const [suspendTarget, setSuspendTarget] = useState<AdminUser | null>(null)
  const [impersonateTarget, setImpersonateTarget] = useState<AdminUser | null>(null)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)
  // Reset to page 0 whenever the search term or page size changes —
  // a narrower filter (or wider page) can leave us pointing past the
  // end of the result set.
  useEffect(() => {
    setPage(0)
  }, [search, pageSize])

  const usersQ = useQuery({
    queryKey: ["admin", "users", search, page, pageSize],
    queryFn: () =>
      adminListUsers(search || undefined, pageSize, page * pageSize),
    placeholderData: (prev) => prev,
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

  const impersonateM = useMutation({
    mutationFn: (id: string) => adminImpersonateUser(id),
    onSuccess: async () => {
      try {
        const updated = await me()
        setUser(updated)
        setImpersonateTarget(null)
        toast.success(`Now acting as ${impersonateTarget?.email ?? "user"}`)
        void navigate("/app")
      } catch {
        toast.error("Impersonation started but failed to refresh session")
      }
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const items = usersQ.data?.items ?? []

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 02"
          title="Users"
          sub={`${usersQ.data?.total ?? 0} total · ${items.filter((u) => u.status === "active").length} active`}
          right={
            <div className="relative w-64">
              <IconSearch className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter email…"
                className="h-8 pl-8"
              />
            </div>
          }
        />
      </StaggerItem>

      <StaggerItem>
      <Panel flush>
        {usersQ.isLoading && (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-10 rounded-none" />
            <Skeleton className="h-10 rounded-none" />
            <Skeleton className="h-10 rounded-none" />
          </div>
        )}
        {usersQ.data && (
          <div className="zv-table-scroll">
          <table className="zv-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>2FA</th>
                <th className="zv-num">Devices</th>
                <th>Last login</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((u) => {
                const isSelf = u.id === self?.id
                return (
                  <tr key={u.id}>
                    <td>
                      <Link
                        to={`/admin/users/${u.id}`}
                        className="hover:text-primary inline-flex items-center gap-2 transition-colors"
                      >
                        <span className="border-border bg-card flex size-6 shrink-0 items-center justify-center border p-0.5">
                          <Identicon seed={u.email} size={20} cells={5} />
                        </span>
                        <span className="font-medium underline-offset-2 hover:underline">
                          {u.email}
                        </span>
                      </Link>
                      {isSelf && (
                        <span className="text-muted-foreground/60 ml-2 font-mono text-[10px] uppercase">
                          you
                        </span>
                      )}
                    </td>
                    <td>
                      {u.role === "admin" ? (
                        <Pill tone="info" dot={false}>
                          admin
                        </Pill>
                      ) : (
                        <span className="text-muted-foreground">user</span>
                      )}
                    </td>
                    <td>
                      <StatusPill
                        status={USER_STATUS_TO_PILL[u.status] ?? "pending"}
                        label={u.status.replace(/_/g, " ")}
                      />
                    </td>
                    <td>
                      {u.totp_enabled ? (
                        <Pill tone="ok" dot={false}>
                          on
                        </Pill>
                      ) : (
                        <Pill tone="warn" dot={false}>
                          off
                        </Pill>
                      )}
                    </td>
                    <td className="zv-num">{u.device_count}</td>
                    <td className="text-muted-foreground font-mono text-xs">
                      <RelativeTime value={u.last_login_at} fallback="Never" />
                    </td>
                    <td className="zv-actions">
                      {!isSelf && u.status === "active" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setImpersonateTarget(u)}
                        >
                          Impersonate
                        </Button>
                      )}
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
                    </td>
                  </tr>
                )
              })}
              {!usersQ.isLoading && items.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-muted-foreground py-8 text-center font-mono text-sm"
                  >
                    No users match.
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
          total={usersQ.data?.total ?? 0}
          itemCount={items.length}
          fetching={usersQ.isFetching}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Panel>
      </StaggerItem>

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

      <ConfirmDialog
        open={!!impersonateTarget}
        onOpenChange={(o) => !o && setImpersonateTarget(null)}
        title={`Impersonate ${impersonateTarget?.email ?? "user"}?`}
        description="You will be redirected to the dashboard acting as this user. A banner will remind you to exit impersonation when done."
        confirmLabel="Impersonate"
        pending={impersonateM.isPending}
        onConfirm={() =>
          impersonateTarget && impersonateM.mutate(impersonateTarget.id)
        }
      />
    </PageStagger>
  )
}
