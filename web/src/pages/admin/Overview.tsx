import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  ApiError,
  type AdminUser,
  type UserStatus,
  adminGetMaintenance,
  adminListUsers,
  adminSetMaintenance,
  adminSetUserStatus,
  logout,
} from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function AdminOverviewPage() {
  const navigate = useNavigate()
  const reset = useAuth((s) => s.reset)
  const user = useAuth((s) => s.user)
  const qc = useQueryClient()

  const [search, setSearch] = useState("")
  const usersQ = useQuery({
    queryKey: ["admin", "users", search],
    queryFn: () => adminListUsers(search || undefined),
  })

  const maintQ = useQuery({
    queryKey: ["admin", "maintenance"],
    queryFn: adminGetMaintenance,
  })

  const setStatusM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      adminSetUserStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] })
      toast.success("User status updated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const setMaintM = useMutation({
    mutationFn: (on: boolean) => adminSetMaintenance(on),
    onSuccess: (_d, on) => {
      void qc.invalidateQueries({ queryKey: ["admin", "maintenance"] })
      toast.info(on ? "Maintenance mode ON" : "Maintenance mode OFF")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">Admin · ZeroVPN</h1>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">{user?.email}</span>
          <Button asChild variant="outline" size="sm">
            <Link to="/app">User dashboard</Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await logout()
              reset()
              navigate("/")
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 p-6">
        <section className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Maintenance mode</h2>
              <p className="text-muted-foreground text-xs">
                When ON, the API enters read-only and the user UI shows a banner.
                {maintQ.data?.maintenance_mode && (
                  <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                    Currently ON.
                  </span>
                )}
              </p>
            </div>
            <Button
              variant={maintQ.data?.maintenance_mode ? "destructive" : "default"}
              onClick={() => setMaintM.mutate(!maintQ.data?.maintenance_mode)}
              disabled={setMaintM.isPending || maintQ.isLoading}
            >
              {maintQ.data?.maintenance_mode ? "Disable" : "Enable"}
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Users</h2>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email…"
              className="border-input bg-background w-72 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          {usersQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
          {usersQ.data && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase">
                  <tr>
                    <th className="p-2">Email</th>
                    <th className="p-2">Role</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">2FA</th>
                    <th className="p-2">Devices</th>
                    <th className="p-2">Last login</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {usersQ.data.items.map((u) => (
                    <UserRow
                      key={u.id}
                      u={u}
                      isSelf={u.id === user?.id}
                      onSet={(status) => setStatusM.mutate({ id: u.id, status })}
                    />
                  ))}
                  {usersQ.data.items.length === 0 && (
                    <tr>
                      <td className="text-muted-foreground p-3" colSpan={7}>
                        No users.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Total: {usersQ.data?.total ?? 0}
          </p>
        </section>

        <section>
          <p className="text-muted-foreground text-xs">
            <Link to="/admin/audit" className="underline">
              Audit log →
            </Link>
            {" · "}
            <Link to="/admin/failed-logins" className="underline">
              Failed logins →
            </Link>
          </p>
        </section>
      </main>
    </div>
  )
}

function UserRow({
  u,
  isSelf,
  onSet,
}: {
  u: AdminUser
  isSelf: boolean
  onSet: (status: UserStatus) => void
}) {
  return (
    <tr className="border-t">
      <td className="p-2">{u.email}</td>
      <td className="p-2">{u.role}</td>
      <td className="p-2">
        <StatusPill status={u.status} />
      </td>
      <td className="p-2">{u.totp_enabled ? "Yes" : "—"}</td>
      <td className="p-2 tabular-nums">{u.device_count}</td>
      <td className="p-2 text-xs">
        {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}
      </td>
      <td className="p-2 text-right">
        {!isSelf && u.status === "active" && (
          <Button size="sm" variant="outline" onClick={() => onSet("suspended")}>
            Suspend
          </Button>
        )}
        {!isSelf && u.status === "suspended" && (
          <Button size="sm" onClick={() => onSet("active")}>
            Unsuspend
          </Button>
        )}
      </td>
    </tr>
  )
}

function StatusPill({ status }: { status: UserStatus }) {
  const cls =
    status === "active"
      ? "bg-green-500/15 text-green-700 dark:text-green-400"
      : status === "suspended"
        ? "bg-red-500/15 text-red-700 dark:text-red-400"
        : status === "pending_verification"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          : "bg-gray-500/15 text-gray-700 dark:text-gray-400"
  return <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{status}</span>
}
