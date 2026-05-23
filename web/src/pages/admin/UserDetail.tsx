import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconChevronDown,
  IconDeviceDesktop,
  IconKey,
  IconLogout,
  IconMail,
  IconShieldOff,
  IconTrash,
  IconUserShield,
  IconUserX,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { BandwidthChart } from "@/components/charts/LazyBandwidthChart"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Identicon } from "@/components/Identicon"
import { PageStagger, StaggerItem } from "@/components/motion"
import { RelativeTime } from "@/components/RelativeTime"
import { Kbd, PageHead, Panel, Pill, type PillTone } from "@/components/swiss"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ApiError,
  type BandwidthBucket,
  type BandwidthRange,
  type ConnectionSessionRow,
  type DeviceStatus,
  type EndpointHistoryRow,
  type UserRole,
  type UserStatus,
  adminDeleteUser,
  adminDisableUser2FA,
  adminGetUserDetail,
  adminImpersonateUser,
  adminListDeviceConnectionHistory,
  adminListDeviceEndpointHistory,
  adminRevokeUserSessions,
  adminSendPasswordReset,
  adminSetUserEmail,
  adminSetUserQuota,
  adminSetUserRole,
  adminSetUserStatus,
  adminUserBandwidth,
  me as fetchMe,
} from "@/lib/api"
import { formatBytes } from "@/lib/units"
import { useAuth } from "@/stores/auth"

const USER_STATUS_TO_PILL: Record<UserStatus, Status> = {
  active: "active",
  suspended: "revoked",
  pending_verification: "pending",
  deleted: "offline",
}

const DEVICE_STATUS_TO_PILL: Record<DeviceStatus, Status> = {
  active: "active",
  paused: "paused",
  revoked: "revoked",
}

const GIB = 1024 ** 3

export function UserDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const self = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [suspendOpen, setSuspendOpen] = useState(false)
  const [impersonateOpen, setImpersonateOpen] = useState(false)
  const [quotaOpen, setQuotaOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [disable2faOpen, setDisable2faOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [roleOpen, setRoleOpen] = useState(false)
  const [revokeSessionsOpen, setRevokeSessionsOpen] = useState(false)
  const [editEmailOpen, setEditEmailOpen] = useState(false)
  const [bwRange, setBwRange] = useState<BandwidthRange>("24h")
  // ID of the device whose endpoint-history dialog is open; null means
  // closed. Phase 2 / Stage A — admins click the "history" cell on any
  // device row to drill into every distinct WG endpoint that peer has
  // ever connected from.
  const [endpointDevice, setEndpointDevice] = useState<{
    id: string
    name: string
  } | null>(null)
  // Phase 2 / Stage B — connection-session history per device.
  const [connectionDevice, setConnectionDevice] = useState<{
    id: string
    name: string
  } | null>(null)

  const detailQ = useQuery({
    queryKey: ["admin", "user", id],
    queryFn: () => adminGetUserDetail(id),
    enabled: !!id,
  })

  const bwQ = useQuery({
    queryKey: ["admin", "user", id, "bandwidth", bwRange],
    queryFn: () => adminUserBandwidth(id, bwRange),
    enabled: !!id,
  })

  const u = detailQ.data?.user
  const isSelf = u?.id === self?.id

  const invalidateUser = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "user", id] })
    void qc.invalidateQueries({ queryKey: ["admin", "users"] })
  }

  const setStatusM = useMutation({
    mutationFn: (status: UserStatus) => adminSetUserStatus(id, status),
    onSuccess: () => {
      invalidateUser()
      setSuspendOpen(false)
      toast.success("User status updated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const setRoleM = useMutation({
    mutationFn: (role: UserRole) => adminSetUserRole(id, role),
    onSuccess: (_, role) => {
      invalidateUser()
      setRoleOpen(false)
      toast.success(`Role set to ${role}`)
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const sendResetM = useMutation({
    mutationFn: () => adminSendPasswordReset(id),
    onSuccess: () => {
      setResetOpen(false)
      toast.success("Password-reset link sent")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const disable2faM = useMutation({
    mutationFn: () => adminDisableUser2FA(id),
    onSuccess: () => {
      invalidateUser()
      setDisable2faOpen(false)
      toast.success("2FA disabled — user can re-enroll on next sign-in")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const revokeSessionsM = useMutation({
    mutationFn: () => adminRevokeUserSessions(id),
    onSuccess: () => {
      setRevokeSessionsOpen(false)
      toast.success("All sessions for this user invalidated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const setEmailM = useMutation({
    mutationFn: (email: string) => adminSetUserEmail(id, email),
    onSuccess: () => {
      invalidateUser()
      setEditEmailOpen(false)
      toast.success("Email updated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const deleteM = useMutation({
    mutationFn: () => adminDeleteUser(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] })
      setDeleteOpen(false)
      toast.success("User deleted")
      void navigate("/admin/users")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const impersonateM = useMutation({
    mutationFn: () => adminImpersonateUser(id),
    onSuccess: async () => {
      try {
        const updated = await fetchMe()
        setUser(updated)
        setImpersonateOpen(false)
        toast.success(`Now acting as ${u?.email ?? "user"}`)
        void navigate("/app")
      } catch {
        toast.error("Impersonation started but failed to refresh session")
      }
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow={`Admin · User · ${id.slice(0, 8)}`}
          title={
            u ? (
              <span className="inline-flex items-center gap-3">
                <span className="border-border bg-card flex size-9 shrink-0 items-center justify-center border p-0.5">
                  <Identicon seed={u.email} size={32} cells={5} />
                </span>
                <span className="truncate">{u.email}</span>
              </span>
            ) : detailQ.isLoading ? (
              "Loading…"
            ) : (
              "Unknown user"
            )
          }
          sub={
            u && (
              <span className="flex flex-wrap items-center gap-2">
                <Pill
                  tone={u.role === "admin" ? "info" : "neutral"}
                  dot={false}
                >
                  {u.role}
                </Pill>
                <StatusPill
                  status={USER_STATUS_TO_PILL[u.status] ?? "pending"}
                  label={u.status.replace(/_/g, " ")}
                />
                {u.totp_enabled ? (
                  <Pill tone="ok" dot={false}>
                    2FA on
                  </Pill>
                ) : (
                  <Pill tone="warn" dot={false}>
                    2FA off
                  </Pill>
                )}
                {u.must_change_password && (
                  <Pill tone="warn" dot={false}>
                    must change password
                  </Pill>
                )}
                {isSelf && (
                  <span className="text-muted-foreground/70 font-mono text-[10px] uppercase">
                    you
                  </span>
                )}
              </span>
            )
          }
          right={
            u && !isSelf ? (
              <>
                {u.status === "active" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setImpersonateOpen(true)}
                  >
                    <IconUserX className="size-4" />
                    Impersonate
                  </Button>
                )}
                {u.status === "active" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSuspendOpen(true)}
                  >
                    Suspend
                  </Button>
                ) : u.status === "suspended" ? (
                  <Button size="sm" onClick={() => setStatusM.mutate("active")}>
                    Unsuspend
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      Actions
                      <IconChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[14rem]">
                    <DropdownMenuLabel>Identity</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => setEditEmailOpen(true)}>
                      <IconMail />
                      Edit email
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Recovery</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => setResetOpen(true)}>
                      <IconKey />
                      Send password-reset email
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setDisable2faOpen(true)}
                      disabled={!u.totp_enabled}
                    >
                      <IconShieldOff />
                      Disable 2FA
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setRevokeSessionsOpen(true)}
                    >
                      <IconLogout />
                      Force-logout all sessions
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Role</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => setRoleOpen(true)}>
                      <IconUserShield />
                      {u.role === "admin"
                        ? "Demote to user"
                        : "Promote to admin"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setDeleteOpen(true)}
                    >
                      <IconTrash />
                      Delete user…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null
          }
        />
      </StaggerItem>

      {detailQ.isLoading && (
        <StaggerItem>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Skeleton className="h-40 rounded-none" />
            <Skeleton className="h-40 rounded-none" />
          </div>
        </StaggerItem>
      )}

      {u && (
        <>
          <StaggerItem>
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
              <Panel title="Account">
                <KvList
                  items={[
                    ["ID", <code key="id" className="font-mono text-[11px]">{u.id}</code>],
                    [
                      "Created",
                      <RelativeTime key="c" value={u.created_at} fallback="—" />,
                    ],
                    [
                      "Last login",
                      <RelativeTime key="l" value={u.last_login_at} fallback="Never" />,
                    ],
                    [
                      "Email verified",
                      u.email_verified_at ? (
                        <RelativeTime
                          key="v"
                          value={u.email_verified_at}
                          fallback="—"
                        />
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">
                          Not verified
                        </span>
                      ),
                    ],
                    [
                      "Password changed",
                      <RelativeTime
                        key="p"
                        value={u.password_changed_at}
                        fallback="—"
                      />,
                    ],
                    ["Devices", `${u.device_count}`],
                  ]}
                />
              </Panel>

              <Panel
                title="Bandwidth quota"
                right={
                  !isSelf && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setQuotaOpen(true)}
                    >
                      Edit cap
                    </Button>
                  )
                }
              >
                <QuotaSummary
                  used={u.current_month_bytes}
                  cap={u.monthly_byte_cap}
                  resetsAt={u.quota_resets_at}
                />
              </Panel>
            </div>
          </StaggerItem>

          <StaggerItem>
            <Panel
              title="Bandwidth history"
              sub={`Aggregated across all of this user's devices · ${bwRange}`}
              right={
                <RangePicker value={bwRange} onChange={setBwRange} />
              }
            >
              {bwQ.isLoading ? (
                <Skeleton className="h-[220px] rounded-none" />
              ) : (
                <BandwidthChart
                  buckets={(bwQ.data?.buckets ?? []) as BandwidthBucket[]}
                  height={220}
                />
              )}
            </Panel>
          </StaggerItem>

          <StaggerItem>
            <Panel
              title="Devices"
              sub={`${detailQ.data?.devices.length ?? 0} active or paused`}
              flush
            >
              {detailQ.data && detailQ.data.devices.length > 0 ? (
                <div className="zv-table-scroll">
                  <table className="zv-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>OS</th>
                        <th>IP</th>
                        <th>Status</th>
                        <th>Last handshake</th>
                        <th>Last endpoint</th>
                        <th>Connections</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailQ.data.devices.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <Link
                              to={`/admin/devices/${d.id}`}
                              className="hover:text-foreground inline-flex items-center gap-2 underline-offset-2 hover:underline"
                              title="Open admin device detail"
                            >
                              <IconDeviceDesktop className="text-muted-foreground size-4" />
                              <span className="font-medium">{d.name}</span>
                            </Link>
                          </td>
                          <td className="text-muted-foreground capitalize">
                            {d.os}
                          </td>
                          <td className="font-mono text-xs">{d.allocated_ip}</td>
                          <td>
                            <StatusPill
                              status={DEVICE_STATUS_TO_PILL[d.status] ?? "offline"}
                              label={d.status}
                            />
                          </td>
                          <td className="text-muted-foreground font-mono text-xs">
                            <RelativeTime
                              value={d.last_handshake_at}
                              fallback="Never"
                            />
                          </td>
                          <td className="font-mono text-xs">
                            {d.last_peer_endpoint ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setEndpointDevice({ id: d.id, name: d.name })
                                }
                                className="hover:text-foreground text-muted-foreground underline-offset-2 hover:underline"
                                title="View full endpoint history"
                              >
                                {d.last_peer_endpoint}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="text-muted-foreground font-mono text-xs">
                            <button
                              type="button"
                              onClick={() =>
                                setConnectionDevice({ id: d.id, name: d.name })
                              }
                              className="hover:text-foreground underline-offset-2 hover:underline"
                              title="View connection-session history"
                            >
                              history
                            </button>
                          </td>
                          <td className="text-muted-foreground font-mono text-xs">
                            <RelativeTime value={d.created_at} fallback="—" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-muted-foreground py-8 text-center font-mono text-sm">
                  No devices.
                </div>
              )}
            </Panel>
          </StaggerItem>

          <StaggerItem>
            <Panel
              title="Activity timeline"
              sub="Audit + session events + connection sessions, merged chronologically — newest first"
              flush
            >
              {detailQ.data && (() => {
                const items = buildTimeline(detailQ.data)
                if (items.length === 0) {
                  return (
                    <div className="text-muted-foreground py-8 text-center font-mono text-sm">
                      No activity yet.
                    </div>
                  )
                }
                const deviceNameById = new Map(
                  detailQ.data.devices.map((d) => [d.id, d.name]),
                )
                return (
                  <div className="zv-table-scroll min-w-0 max-w-full">
                    <table className="zv-table table-fixed">
                      <thead>
                        <tr>
                          <th className="w-[150px]">When</th>
                          <th className="w-[100px]">Kind</th>
                          <th className="w-[180px]">Event</th>
                          <th className="w-[140px]">IP</th>
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => (
                          <TimelineRow
                            key={`${it.kind}-${it.id}`}
                            item={it}
                            deviceNameById={deviceNameById}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })()}
            </Panel>
          </StaggerItem>
        </>
      )}

      {detailQ.isError && (
        <StaggerItem>
          <Panel title="Failed to load">
            <p className="text-muted-foreground text-sm">
              {detailQ.error instanceof ApiError
                ? detailQ.error.message
                : "Could not fetch user."}
            </p>
          </Panel>
        </StaggerItem>
      )}

      <ConfirmDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title={`Suspend ${u?.email ?? "user"}?`}
        description="Suspends the account, blocks future logins, and keeps device rows in place. Reversible — Unsuspend brings them back."
        confirmLabel="Suspend"
        destructive
        pending={setStatusM.isPending}
        onConfirm={() => setStatusM.mutate("suspended")}
      />

      <ConfirmDialog
        open={impersonateOpen}
        onOpenChange={setImpersonateOpen}
        title={`Impersonate ${u?.email ?? "user"}?`}
        description="You will be redirected to the dashboard acting as this user. A banner will remind you to exit impersonation when done."
        confirmLabel="Impersonate"
        pending={impersonateM.isPending}
        onConfirm={() => impersonateM.mutate()}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={`Email a password-reset link to ${u?.email ?? "user"}?`}
        description="Sends the same reset email the user would get from the public 'Forgot password' flow. Existing reset links for this user are invalidated."
        confirmLabel="Send link"
        pending={sendResetM.isPending}
        onConfirm={() => sendResetM.mutate()}
      />

      <ConfirmDialog
        open={disable2faOpen}
        onOpenChange={setDisable2faOpen}
        title={`Disable 2FA for ${u?.email ?? "user"}?`}
        description="Wipes the user's TOTP secret and recovery codes. Use this when a user has lost their authenticator. They can re-enroll 2FA from Settings → Security after they sign in."
        confirmLabel="Disable 2FA"
        destructive
        pending={disable2faM.isPending}
        onConfirm={() => disable2faM.mutate()}
      />

      <ConfirmDialog
        open={revokeSessionsOpen}
        onOpenChange={setRevokeSessionsOpen}
        title={`Force-logout ${u?.email ?? "user"}?`}
        description="Invalidates every open session for this user. They'll need to sign in again on every device. The action is logged."
        confirmLabel="Force logout"
        destructive
        pending={revokeSessionsM.isPending}
        onConfirm={() => revokeSessionsM.mutate()}
      />

      {u && (
        <EditEmailDialog
          open={editEmailOpen}
          onOpenChange={setEditEmailOpen}
          currentEmail={u.email}
          pending={setEmailM.isPending}
          onSubmit={(email) => setEmailM.mutate(email)}
        />
      )}

      <ConfirmDialog
        open={roleOpen}
        onOpenChange={setRoleOpen}
        title={
          u?.role === "admin"
            ? `Demote ${u?.email ?? "user"} to user?`
            : `Promote ${u?.email ?? "user"} to admin?`
        }
        description={
          u?.role === "admin"
            ? "Removes admin privileges. They keep their account and devices."
            : "Grants full administrative access — including the ability to manage other users, servers, and impersonation."
        }
        confirmLabel={u?.role === "admin" ? "Demote" : "Promote"}
        destructive={u?.role === "admin"}
        pending={setRoleM.isPending}
        onConfirm={() =>
          setRoleM.mutate(u?.role === "admin" ? "user" : "admin")
        }
      />

      {u && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`Delete ${u.email}?`}
          description="Permanently deletes this user and ALL of their data — every device/peer is removed and all sessions, logs, bandwidth history, and preferences are purged from the database. This is irreversible."
          confirmLabel="Delete permanently"
          destructive
          confirmText={u.email}
          pending={deleteM.isPending}
          onConfirm={() => deleteM.mutate()}
        />
      )}

      {u && (
        <QuotaDialog
          open={quotaOpen}
          onOpenChange={setQuotaOpen}
          userId={u.id}
          currentCap={u.monthly_byte_cap}
          onSaved={invalidateUser}
        />
      )}

      <EndpointHistoryDialog
        device={endpointDevice}
        onOpenChange={(open) => {
          if (!open) setEndpointDevice(null)
        }}
      />

      <ConnectionHistoryDialog
        device={connectionDevice}
        onOpenChange={(open) => {
          if (!open) setConnectionDevice(null)
        }}
      />
    </PageStagger>
  )
}

// ──────────────────────────────────────────────────────────────────────

function KvList({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground font-mono text-xs uppercase tracking-wide">
            {k}
          </dt>
          <dd className="text-foreground min-w-0 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function RangePicker({
  value,
  onChange,
}: {
  value: BandwidthRange
  onChange: (r: BandwidthRange) => void
}) {
  const opts: BandwidthRange[] = ["24h", "7d", "30d"]
  return (
    <div className="border-border inline-flex border">
      {opts.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`px-2 py-0.5 font-mono text-[11px] transition-colors ${value === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

function QuotaSummary({
  used,
  cap,
  resetsAt,
}: {
  used: number
  cap: number | null
  resetsAt: string | null
}) {
  if (!cap || cap <= 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className="font-mono text-2xl">{formatBytes(used)}</div>
        <div className="text-muted-foreground text-xs">
          No cap — unlimited usage this month
        </div>
        {resetsAt && (
          <div className="text-muted-foreground/70 font-mono text-[11px]">
            Counter resets <RelativeTime value={resetsAt} fallback="—" />
          </div>
        )}
      </div>
    )
  }
  const pct = Math.min(100, Math.round((used / cap) * 100))
  const tone =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-2xl">{formatBytes(used)}</span>
        <span className="text-muted-foreground font-mono text-xs">
          / {formatBytes(cap)} ({pct}%)
        </span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {resetsAt && (
        <div className="text-muted-foreground/70 font-mono text-[11px]">
          Counter resets <RelativeTime value={resetsAt} fallback="—" />
        </div>
      )}
    </div>
  )
}

function QuotaDialog({
  open,
  onOpenChange,
  userId,
  currentCap,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  userId: string
  currentCap: number | null
  onSaved: () => void
}) {
  const [gibStr, setGibStr] = useState("")

  useEffect(() => {
    if (open) {
      setGibStr(currentCap ? (currentCap / GIB).toFixed(2) : "")
    }
  }, [open, currentCap])

  const m = useMutation({
    mutationFn: (cap: number | null) => adminSetUserQuota(userId, cap),
    onSuccess: () => {
      toast.success("Quota updated")
      onSaved()
      onOpenChange(false)
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const submit = () => {
    const trimmed = gibStr.trim()
    if (!trimmed) {
      m.mutate(null)
      return
    }
    const gib = Number(trimmed)
    if (!Number.isFinite(gib) || gib < 0) {
      toast.error("Enter a non-negative number of GiB, or leave blank for unlimited")
      return
    }
    m.mutate(gib > 0 ? Math.round(gib * GIB) : null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit monthly bandwidth cap</DialogTitle>
          <DialogDescription>
            Cap is enforced per calendar month. Leave blank or enter 0 for unlimited.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cap-gib">Monthly cap (GiB)</Label>
          <Input
            id="cap-gib"
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={gibStr}
            onChange={(e) => setGibStr(e.target.value)}
            placeholder="Unlimited"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={m.isPending} onClick={submit}>
            {m.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function toneForAction(action: string): PillTone {
  if (action.startsWith("admin.impersonate")) return "warn"
  if (action.includes("suspend") || action.includes("delete")) return "err"
  if (action.includes("status")) return "info"
  if (action.includes("quota")) return "info"
  if (action.includes("role")) return "info"
  if (action.includes("password_reset")) return "warn"
  if (action.includes("2fa")) return "warn"
  return "neutral"
}

/**
 * Inline dialog for the admin "Edit email" action. Validates client-side
 * for shape + change + length, then defers to the server for uniqueness
 * (which is checked atomically against the CITEXT column).
 */
function EditEmailDialog({
  open,
  onOpenChange,
  currentEmail,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  currentEmail: string
  pending: boolean
  onSubmit: (email: string) => void
}) {
  const [value, setValue] = useState(currentEmail)
  useEffect(() => {
    if (open) setValue(currentEmail)
  }, [open, currentEmail])

  const trimmed = value.trim().toLowerCase()
  const sameAsCurrent = trimmed === currentEmail.toLowerCase()
  const looksValid = trimmed.includes("@") && trimmed.length >= 3
  const canSubmit = !pending && looksValid && !sameAsCurrent

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit email</DialogTitle>
          <DialogDescription>
            Updates the address of record for <code className="font-mono">{currentEmail}</code>.
            The user keeps their devices, role, password, and 2FA. Their
            existing sessions are not invalidated automatically — use
            "Force-logout all sessions" if you want that.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-email">New email</Label>
          <Input
            id="edit-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="user@example.com"
          />
          {sameAsCurrent && trimmed.length > 0 && (
            <p className="text-muted-foreground text-[11px]">
              Same as current — nothing to change.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => onSubmit(trimmed)}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function summarizeMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return ""
  const obj = metadata as Record<string, unknown>
  const parts: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue
    if (typeof v === "object") continue
    parts.push(`${k}=${String(v)}`)
    if (parts.length >= 3) break
  }
  return parts.join(" · ")
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2 / Stage B — unified activity timeline. Merges three feeds
// fetched server-side (audit / session_events / connection_sessions)
// into one chronological list. Each item is a discriminated union and
// renders to one table row.

type TimelineItem =
  | {
      kind: "audit"
      id: number
      ts: string
      action: string
      metadata: unknown
      ip: string | null
      user_agent: string | null
      target_type: string | null
      target_id: string | null
    }
  | {
      kind: "session"
      id: number
      ts: string
      event: string
      ip: string | null
      user_agent: string | null
      metadata: unknown
    }
  | {
      kind: "connection"
      id: number
      ts: string
      device_id: string
      started_at: string
      ended_at: string | null
      endpoint_start: string | null
      endpoint_end: string | null
      rx: number | null
      tx: number | null
    }

function buildTimeline(d: {
  activity: import("@/lib/api").AdminUserActivity[]
  session_events: import("@/lib/api").SessionEventRow[]
  connection_sessions: import("@/lib/api").ConnectionSessionRow[]
}): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const a of d.activity) {
    items.push({
      kind: "audit",
      id: a.id,
      ts: a.created_at,
      action: a.action,
      metadata: a.metadata,
      ip: a.ip,
      user_agent: a.user_agent,
      target_type: a.target_type,
      target_id: a.target_id,
    })
  }
  for (const e of d.session_events) {
    items.push({
      kind: "session",
      id: e.id,
      ts: e.created_at,
      event: e.event,
      ip: e.ip,
      user_agent: e.user_agent,
      metadata: e.metadata,
    })
  }
  for (const c of d.connection_sessions) {
    const rx =
      c.rx_bytes_at_end != null
        ? Math.max(0, c.rx_bytes_at_end - c.rx_bytes_at_start)
        : null
    const tx =
      c.tx_bytes_at_end != null
        ? Math.max(0, c.tx_bytes_at_end - c.tx_bytes_at_start)
        : null
    items.push({
      kind: "connection",
      id: c.id,
      ts: c.started_at,
      device_id: c.device_id,
      started_at: c.started_at,
      ended_at: c.ended_at,
      endpoint_start: c.peer_endpoint_at_start,
      endpoint_end: c.peer_endpoint_at_end,
      rx,
      tx,
    })
  }
  items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
  return items
}

function TimelineRow({
  item,
  deviceNameById,
}: {
  item: TimelineItem
  deviceNameById: Map<string, string>
}) {
  if (item.kind === "audit") {
    const targetLabel = item.target_type
      ? `${item.target_type}${item.target_id ? `·${item.target_id.slice(0, 6)}` : ""}`
      : null
    return (
      <tr>
        <td className="text-muted-foreground font-mono text-xs">
          <RelativeTime value={item.ts} fallback="—" />
        </td>
        <td>
          <Pill tone="info" dot={false}>
            audit
          </Pill>
        </td>
        <td>
          <Pill tone={toneForAction(item.action)} dot={false}>
            {item.action}
          </Pill>
        </td>
        <td className="font-mono text-xs tabular-nums">
          {item.ip ? (
            item.ip.replace(/\/(32|128)$/, "")
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="min-w-0 text-muted-foreground font-mono text-[11px]">
          <span className="block max-w-full truncate" title={summarizeMetadata(item.metadata)}>
            {targetLabel && (
              <span className="text-foreground mr-2">→ {targetLabel}</span>
            )}
            {summarizeMetadata(item.metadata)}
          </span>
        </td>
      </tr>
    )
  }
  if (item.kind === "session") {
    return (
      <tr>
        <td className="text-muted-foreground font-mono text-xs">
          <RelativeTime value={item.ts} fallback="—" />
        </td>
        <td>
          <Pill tone="ok" dot={false}>
            session
          </Pill>
        </td>
        <td>
          <Kbd>{item.event}</Kbd>
        </td>
        <td className="font-mono text-xs tabular-nums">
          {item.ip ? (
            item.ip.replace(/\/(32|128)$/, "")
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="min-w-0 text-muted-foreground font-mono text-[11px]" title={item.user_agent ?? undefined}>
          <span className="block max-w-full truncate">
            {summarizeMetadata(item.metadata)}
            {item.user_agent && (
              <span className="ml-2 inline-block max-w-full truncate align-bottom">
                {item.user_agent}
              </span>
            )}
          </span>
        </td>
      </tr>
    )
  }
  // connection
  const open = item.ended_at == null
  const deviceName =
    deviceNameById.get(item.device_id) ?? item.device_id.slice(0, 8)
  const duration = open ? "active" : connectionDuration(item.started_at, item.ended_at!)
  const endpoint = item.endpoint_start
    ? item.endpoint_start +
      (item.endpoint_end && item.endpoint_end !== item.endpoint_start
        ? ` → ${item.endpoint_end}`
        : "")
    : null
  return (
    <tr>
      <td className="text-muted-foreground font-mono text-xs">
        <RelativeTime value={item.ts} fallback="—" />
      </td>
      <td>
        <Pill tone={open ? "ok" : "neutral"} dot={open}>
          connection
        </Pill>
      </td>
      <td>
        <span className="font-mono text-xs">
          <span className="text-foreground">{deviceName}</span>
          <span className="text-muted-foreground"> · </span>
          {open ? "active" : `closed after ${duration}`}
        </span>
      </td>
      <td className="min-w-0 font-mono text-xs" title={endpoint ?? undefined}>
        {endpoint ? (
          <span className="block max-w-full truncate">{endpoint}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="text-muted-foreground font-mono text-[11px] tabular-nums">
        {item.rx != null && item.tx != null
          ? `↓ ${formatBytes(item.rx)} · ↑ ${formatBytes(item.tx)}`
          : open
            ? "in flight"
            : "—"}
      </td>
    </tr>
  )
}

function connectionDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return "—"
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${(s % 60).toString().padStart(2, "0")}s`
  const h = Math.floor(m / 60)
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2 / Stage A — endpoint history dialog. Renders every distinct
// `host:port` the WG poller has ever observed for the device, newest
// first. Capped at 200 rows server-side; if a device sees more than
// that the dialog shows a footnote.

function EndpointHistoryDialog({
  device,
  onOpenChange,
}: {
  device: { id: string; name: string } | null
  onOpenChange: (open: boolean) => void
}) {
  const open = device != null
  const q = useQuery({
    queryKey: ["admin", "device", device?.id, "endpoint-history"],
    queryFn: () => adminListDeviceEndpointHistory(device!.id),
    enabled: open,
    staleTime: 30_000,
  })
  const rows: EndpointHistoryRow[] = q.data ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Endpoint history{device ? ` · ${device.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            Every distinct WireGuard peer endpoint observed for this
            device, newest first. Each row is the moment the endpoint
            changed against the previous observation — repeated polls of
            the same endpoint don't duplicate.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[420px] overflow-y-auto">
          {q.isLoading && (
            <div className="text-muted-foreground py-8 text-center font-mono text-xs">
              Loading…
            </div>
          )}
          {q.isError && (
            <div className="text-destructive py-8 text-center font-mono text-xs">
              Failed to load history.
            </div>
          )}
          {q.data && rows.length === 0 && (
            <div className="text-muted-foreground py-8 text-center font-mono text-sm">
              No endpoints captured yet. The device hasn't completed a
              handshake since this feature shipped.
            </div>
          )}
          {q.data && rows.length > 0 && (
            <div className="zv-table-scroll">
              <table className="zv-table">
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th className="w-[200px]">First seen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono text-xs">{r.endpoint}</td>
                      <td className="text-muted-foreground font-mono text-xs">
                        <RelativeTime value={r.observed_at} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {rows.length === 200 && (
          <p className="text-muted-foreground font-mono text-[11px]">
            Showing the 200 most recent observations. Older entries exist
            but aren't surfaced here yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2 / Stage B — connection-session history. One row per WG
// connection (online → offline pair) with duration, start/end
// endpoint, and rx/tx delivered. Open sessions show "active" and a
// `—` duration. Sessions closed by the worker-startup sweep (no clean
// offline observation) show their start byte counters but the end
// columns are blank.

function ConnectionHistoryDialog({
  device,
  onOpenChange,
}: {
  device: { id: string; name: string } | null
  onOpenChange: (open: boolean) => void
}) {
  const open = device != null
  const q = useQuery({
    queryKey: ["admin", "device", device?.id, "connection-history"],
    queryFn: () => adminListDeviceConnectionHistory(device!.id),
    enabled: open,
    staleTime: 30_000,
  })
  const rows: ConnectionSessionRow[] = q.data ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Connection history{device ? ` · ${device.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            One row per WireGuard connection. `RX` / `TX` are the bytes
            delivered during that session (snapshot end − snapshot
            start). Open sessions show a `—` for end-state columns until
            the peer disconnects.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[420px] overflow-y-auto">
          {q.isLoading && (
            <div className="text-muted-foreground py-8 text-center font-mono text-xs">
              Loading…
            </div>
          )}
          {q.isError && (
            <div className="text-destructive py-8 text-center font-mono text-xs">
              Failed to load history.
            </div>
          )}
          {q.data && rows.length === 0 && (
            <div className="text-muted-foreground py-8 text-center font-mono text-sm">
              No connection sessions yet. The device hasn't transitioned
              online since this feature shipped.
            </div>
          )}
          {q.data && rows.length > 0 && (
            <div className="zv-table-scroll">
              <table className="zv-table">
                <thead>
                  <tr>
                    <th className="w-[180px]">Started</th>
                    <th className="w-[110px]">Duration</th>
                    <th>Endpoint</th>
                    <th className="text-right">RX</th>
                    <th className="text-right">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const open = s.ended_at == null
                    const duration = open
                      ? "active"
                      : formatDuration(s.started_at, s.ended_at!)
                    const rx =
                      s.rx_bytes_at_end != null
                        ? Math.max(0, s.rx_bytes_at_end - s.rx_bytes_at_start)
                        : null
                    const tx =
                      s.tx_bytes_at_end != null
                        ? Math.max(0, s.tx_bytes_at_end - s.tx_bytes_at_start)
                        : null
                    const endpointChanged =
                      !open &&
                      s.peer_endpoint_at_end != null &&
                      s.peer_endpoint_at_end !== s.peer_endpoint_at_start
                    return (
                      <tr key={s.id}>
                        <td className="text-muted-foreground font-mono text-xs">
                          <RelativeTime value={s.started_at} />
                        </td>
                        <td className="font-mono text-xs tabular-nums">
                          {open ? (
                            <Pill tone="ok" dot>
                              active
                            </Pill>
                          ) : (
                            duration
                          )}
                        </td>
                        <td className="font-mono text-xs">
                          {s.peer_endpoint_at_start ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {endpointChanged && (
                            <span
                              className="text-muted-foreground"
                              title={`Ended on ${s.peer_endpoint_at_end}`}
                            >
                              {" → "}
                              {s.peer_endpoint_at_end}
                            </span>
                          )}
                        </td>
                        <td className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                          {rx != null ? (
                            formatBytes(rx)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                          {tx != null ? (
                            formatBytes(tx)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {rows.length === 200 && (
          <p className="text-muted-foreground font-mono text-[11px]">
            Showing the 200 most recent sessions. Older entries exist
            but aren't surfaced here yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Compact duration formatter for the connection-history table.
 *  Shows seconds for <1 min, m:ss for <1 h, otherwise H:MM. */
function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return "—"
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) {
    const s = totalSec % 60
    return `${totalMin}m ${s.toString().padStart(2, "0")}s`
  }
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m.toString().padStart(2, "0")}m`
}
