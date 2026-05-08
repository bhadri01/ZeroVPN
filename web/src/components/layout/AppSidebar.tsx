import {
  IconActivity,
  IconChartLine,
  IconCircleCheck,
  IconCircleDashedX,
  IconClipboardList,
  IconDevices,
  IconKey,
  IconLayoutDashboard,
  IconLogout,
  IconRouter,
  IconShield,
  IconSparkles,
  IconUser,
  IconUserShield,
  IconUsers,
  IconWebhook,
  IconWifi,
} from "@tabler/icons-react"
import { Link, NavLink, useLocation } from "react-router"

import { ModeToggle } from "@/components/mode-toggle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { logout as apiLogout } from "@/lib/api"
import { useAuth } from "@/stores/auth"

type NavEntry = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
}

const WORKSPACE: NavEntry[] = [
  { to: "/app", label: "Dashboard", icon: IconLayoutDashboard, end: true },
  { to: "/app/devices", label: "Devices", icon: IconDevices },
  { to: "/app/bandwidth", label: "Bandwidth", icon: IconChartLine },
  { to: "/app/api-tokens", label: "API tokens", icon: IconKey },
  { to: "/app/security", label: "Security", icon: IconShield },
  { to: "/app/account", label: "Account", icon: IconUser },
]

const ADMIN: NavEntry[] = [
  { to: "/admin", label: "Overview", icon: IconUserShield, end: true },
  { to: "/admin/servers", label: "Servers", icon: IconRouter },
  { to: "/admin/webhooks", label: "Webhooks", icon: IconWebhook },
  { to: "/admin/audit", label: "Audit log", icon: IconClipboardList },
  { to: "/admin/failed-logins", label: "Failed logins", icon: IconCircleDashedX },
  { to: "/admin/users", label: "Users", icon: IconUsers },
]

export function AppSidebar() {
  const user = useAuth((s) => s.user)
  const reset = useAuth((s) => s.reset)
  const { state } = useSidebar()
  const collapsed = state === "collapsed"

  const handleLogout = async () => {
    try {
      await apiLogout()
    } catch {
      /* ignore network failures — UI must still drop session */
    }
    reset()
  }

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="px-3 py-3">
        <Link
          to="/app"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
            <IconSparkles className="size-4" />
          </span>
          {!collapsed && <span>ZeroVPN</span>}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavList entries={WORKSPACE} />
          </SidebarGroupContent>
        </SidebarGroup>

        {user?.role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavList entries={ADMIN} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-accent"
                >
                  <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full text-xs font-semibold">
                    {user?.email?.[0]?.toUpperCase() ?? "?"}
                  </span>
                  <div className="flex min-w-0 flex-col text-left text-xs">
                    <span className="truncate font-medium">{user?.email}</span>
                    <span className="text-muted-foreground capitalize">
                      {user?.role}
                    </span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                className="min-w-[14rem]"
              >
                <DropdownMenuItem asChild>
                  <Link to="/app/account">
                    <IconUser />
                    Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/app/security">
                    <IconShield />
                    Security
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleLogout()}>
                  <IconLogout />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center justify-between px-2 pt-1">
          {!collapsed && <WSStatusPill />}
          <ModeToggle />
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

function NavList({ entries }: { entries: NavEntry[] }) {
  const location = useLocation()
  return (
    <SidebarMenu>
      {entries.map((entry) => {
        const Icon = entry.icon
        return (
          <SidebarMenuItem key={entry.to}>
            <SidebarMenuButton
              asChild
              isActive={
                entry.end
                  ? location.pathname === entry.to
                  : location.pathname.startsWith(entry.to)
              }
              tooltip={entry.label}
            >
              <NavLink to={entry.to} end={entry.end}>
                <Icon className="size-4" />
                <span>{entry.label}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

function WSStatusPill() {
  // Placeholder until we wire useWebSocket; the real connection state lives
  // in the user dashboard's useWebSocket hook. For sidebar-presence we just
  // show a static ok pill — Phase D wires the live state.
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
      <span className="bg-status-online size-1.5 rounded-full" />
      Live
    </span>
  )
}

// Helper for ConnectionStatePill consumers — keep symmetry with old usage.
export function ConnectionPill({
  state,
  label,
}: {
  state: "online" | "offline" | "connecting" | "degraded"
  label?: string
}) {
  const tone =
    state === "online"
      ? "bg-status-online"
      : state === "degraded"
        ? "bg-status-degraded"
        : "bg-status-offline"
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
      <span className={`${tone} size-1.5 rounded-full`} />
      {label ??
        (state === "online"
          ? "Live"
          : state === "connecting"
            ? "Connecting"
            : state === "degraded"
              ? "Degraded"
              : "Offline")}
    </span>
  )
}

/* eslint-disable react-refresh/only-export-components */
// This file exports BOTH the AppSidebar component and the ConnectionPill
// helper used elsewhere — splitting them is more churn than the warning
// is worth.
export const _UnusedIcons = {
  IconActivity,
  IconCircleCheck,
  IconWifi,
}
