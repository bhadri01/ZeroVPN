import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconCopy,
  IconDownload,
  IconPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ApiError,
  type AdminCreatedUser,
  type AdminCreateUserBody,
  type AdminUser,
  type AdminUserListFilters,
  type UserRole,
  type UserStatus,
  adminCreateUser,
  adminImpersonateUser,
  adminListUsers,
  adminSetUserStatus,
  adminUsersCsvUrl,
  me,
} from "@/lib/api"
import { useAuth } from "@/stores/auth"

const USER_STATUS_TO_PILL: Record<UserStatus, Status> = {
  active: "active",
  suspended: "revoked",
  pending_verification: "pending",
  deleted: "offline",
}

type StatusFilter = "all" | UserStatus
type RoleFilter = "all" | UserRole
type TotpFilter = "all" | "on" | "off"

export function UsersPage() {
  const self = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all")
  const [totpFilter, setTotpFilter] = useState<TotpFilter>("all")
  const [suspendTarget, setSuspendTarget] = useState<AdminUser | null>(null)
  const [impersonateTarget, setImpersonateTarget] = useState<AdminUser | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)
  // Reset to page 0 whenever the search term, filters, or page size change —
  // a narrower filter (or wider page) can leave us pointing past the end of
  // the result set.
  useEffect(() => {
    setPage(0)
  }, [search, statusFilter, roleFilter, totpFilter, pageSize])

  const filters = useMemo<AdminUserListFilters>(
    () => ({
      q: search || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      role: roleFilter === "all" ? undefined : roleFilter,
      totp_enabled:
        totpFilter === "all" ? undefined : totpFilter === "on",
    }),
    [search, statusFilter, roleFilter, totpFilter],
  )

  const usersQ = useQuery({
    queryKey: ["admin", "users", filters, page, pageSize],
    queryFn: () => adminListUsers(filters, pageSize, page * pageSize),
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
  const filtersActive =
    statusFilter !== "all" ||
    roleFilter !== "all" ||
    totpFilter !== "all" ||
    !!search

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 02"
          title="Users"
          sub={`${usersQ.data?.total ?? 0} total · ${items.filter((u) => u.status === "active").length} active`}
          right={
            <>
              <a
                href={adminUsersCsvUrl(filters)}
                download="users.csv"
                className="border-border text-muted-foreground hover:text-foreground hover:border-foreground inline-flex h-8 items-center gap-1.5 border px-2.5 text-xs transition-colors"
                title="Export CSV (current filters)"
              >
                <IconDownload className="size-3.5" />
                CSV
              </a>
              <Button
                size="sm"
                onClick={() => setInviteOpen(true)}
                className="gap-1.5"
              >
                <IconPlus className="size-4" />
                Invite user
              </Button>
            </>
          }
        />
      </StaggerItem>

      <StaggerItem>
        <Panel flush>
          <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
            <div className="relative w-64">
              <IconSearch className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter email…"
                className="h-8 pl-8"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="pending_verification">Pending verify</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={roleFilter}
              onValueChange={(v) => setRoleFilter(v as RoleFilter)}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={totpFilter}
              onValueChange={(v) => setTotpFilter(v as TotpFilter)}
            >
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="2FA" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">2FA: any</SelectItem>
                <SelectItem value="on">2FA: on</SelectItem>
                <SelectItem value="off">2FA: off</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch("")
                  setStatusFilter("all")
                  setRoleFilter("all")
                  setTotpFilter("all")
                }}
                className="h-8 text-xs"
              >
                <IconX className="size-3.5" />
                Clear
              </Button>
            )}
          </div>

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
                                setStatusM.mutate({
                                  id: u.id,
                                  status: "active",
                                })
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

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={() => {
          void qc.invalidateQueries({ queryKey: ["admin", "users"] })
        }}
      />
    </PageStagger>
  )
}

// ──────────────────────────────────────────────────────────────────────

function InviteUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<UserRole>("user")
  const [skipVerify, setSkipVerify] = useState(false)
  const [emailLink, setEmailLink] = useState(true)
  const [created, setCreated] = useState<AdminCreatedUser | null>(null)

  // Reset on close so re-opening is a clean slate (the credentials view
  // takes priority while `created` is set).
  useEffect(() => {
    if (!open) {
      setEmail("")
      setRole("user")
      setSkipVerify(false)
      setEmailLink(true)
      setCreated(null)
    }
  }, [open])

  const m = useMutation({
    mutationFn: (body: AdminCreateUserBody) => adminCreateUser(body),
    onSuccess: (resp) => {
      onCreated()
      if (resp.generated_password) {
        // Switch to the credentials view — the admin must be able to
        // see + copy the plaintext exactly once.
        setCreated(resp)
        toast.success("User created. Copy the password — it won't be shown again.")
      } else {
        toast.success("User created. A setup email was sent.")
        onOpenChange(false)
      }
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const submit = () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed.includes("@")) {
      toast.error("Enter a valid email")
      return
    }
    m.mutate({
      email: trimmed,
      role,
      skip_verification: skipVerify,
      email_setup_link: emailLink,
    })
  }

  const copyPassword = async () => {
    if (!created?.generated_password) return
    try {
      await navigator.clipboard.writeText(created.generated_password)
      toast.success("Password copied")
    } catch {
      toast.error("Clipboard blocked — copy manually")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>User created</DialogTitle>
              <DialogDescription>
                {emailLink
                  ? "A setup link was emailed to the user."
                  : "Hand this password off to the user out-of-band. It won't be shown again."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-muted-foreground text-xs">Email</Label>
                <code className="border-border bg-muted/40 border px-2 py-1.5 font-mono text-xs">
                  {created.email}
                </code>
              </div>
              {created.generated_password && (
                <div className="flex flex-col gap-1">
                  <Label className="text-muted-foreground text-xs">
                    Generated password
                  </Label>
                  <div className="flex items-center gap-2">
                    <code className="border-border bg-muted/40 flex-1 select-all border px-2 py-1.5 font-mono text-xs">
                      {created.generated_password}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copyPassword()}
                    >
                      <IconCopy className="size-3.5" />
                      Copy
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    The user is forced to change this on first sign-in.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite user</DialogTitle>
              <DialogDescription>
                We'll generate a random password and email a setup link by
                default. Uncheck "Email setup link" to instead show the
                password here once for out-of-band delivery.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Role</Label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as UserRole)}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-start gap-2 text-xs">
                <Checkbox
                  checked={skipVerify}
                  onCheckedChange={(c) => setSkipVerify(c === true)}
                />
                <span>
                  <span className="text-foreground block font-medium">
                    Skip email verification
                  </span>
                  <span className="text-muted-foreground">
                    Account becomes active immediately. Useful for offline
                    onboarding.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs">
                <Checkbox
                  checked={emailLink}
                  onCheckedChange={(c) => setEmailLink(c === true)}
                />
                <span>
                  <span className="text-foreground block font-medium">
                    Email setup link
                  </span>
                  <span className="text-muted-foreground">
                    Sends a password-reset link instead of revealing the
                    generated password here.
                  </span>
                </span>
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={m.isPending} onClick={submit}>
                {m.isPending ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
