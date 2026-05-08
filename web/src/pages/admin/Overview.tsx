import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconSearch, IconShieldCheck } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/PageHeader"
import { RelativeTime } from "@/components/RelativeTime"
import { Stat } from "@/components/Stat"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
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
  adminGetMaintenance,
  adminListUsers,
  adminSetMaintenance,
  adminSetUserStatus,
} from "@/lib/api"
import { useAuth } from "@/stores/auth"

const USER_STATUS_TO_PILL: Record<UserStatus, Status> = {
  active: "active",
  suspended: "revoked",
  pending_verification: "pending",
  deleted: "offline",
}

export function AdminOverviewPage() {
  const me = useAuth((s) => s.user)
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

  const items = usersQ.data?.items ?? []
  const total = usersQ.data?.total ?? 0
  const active = items.filter((u) => u.status === "active").length
  const suspended = items.filter((u) => u.status === "suspended").length
  const totalDevices = items.reduce((s, u) => s + u.device_count, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin overview"
        description="Operate the deployment: users, maintenance, audit, servers."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total users" value={total} />
        <Stat label="Active" value={active} />
        <Stat label="Suspended" value={suspended} />
        <Stat label="Devices" value={totalDevices} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconShieldCheck className="size-4" />
            Maintenance mode
          </CardTitle>
          <CardDescription>
            When ON, the API rejects writes with 503 and the UI shows a
            site-wide banner.
            {maintQ.data?.maintenance_mode && (
              <span className="text-status-degraded ml-1 font-medium">
                Currently ON.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Switch
            checked={!!maintQ.data?.maintenance_mode}
            onCheckedChange={(v) => setMaintM.mutate(v)}
            disabled={setMaintM.isPending || maintQ.isLoading}
            aria-label="Maintenance mode"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Users</CardTitle>
            <CardDescription>
              Search, suspend, unsuspend. {total.toLocaleString()} total.
            </CardDescription>
          </div>
          <div className="relative w-72">
            <IconSearch className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email…"
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent>
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
              {items.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  isSelf={u.id === me?.id}
                  onSet={(status) =>
                    setStatusM.mutate({ id: u.id, status })
                  }
                />
              ))}
              {!usersQ.isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                    No users match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
    <TableRow>
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
        <StatusPill status={USER_STATUS_TO_PILL[u.status] ?? "pending"} label={u.status.replace(/_/g, " ")} />
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
          <Button size="sm" variant="outline" onClick={() => onSet("suspended")}>
            Suspend
          </Button>
        )}
        {!isSelf && u.status === "suspended" && (
          <Button size="sm" onClick={() => onSet("active")}>
            Unsuspend
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
