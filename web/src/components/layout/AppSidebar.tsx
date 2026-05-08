import {
  IconChartLine,
  IconCircleDashedX,
  IconClipboardList,
  IconDevices,
  IconKey,
  IconLayoutDashboard,
  IconLayoutSidebar,
  IconLayoutSidebarLeftCollapse,
  IconRouter,
  IconShield,
  IconSparkles,
  IconUser,
  IconUserShield,
  IconUsers,
  IconWebhook,
} from "@tabler/icons-react"
import { Link, NavLink, useLocation } from "react-router"

import { MiniAreaChart } from "@/components/charts/LazyMiniAreaChart"
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
import { useAuth } from "@/stores/auth"
import { aggregateLiveStats, useLiveStats } from "@/stores/liveStats"

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
  const { state } = useSidebar()
  const collapsed = state === "collapsed"

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
        {!collapsed && <LivePulse />}
        <CollapseToggle collapsed={collapsed} />
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

/**
 * Aggregate live RX/TX sparkline + numeric labels for the sidebar
 * footer. Reads from the shared liveStats store; renders nothing if
 * there's no data yet (avoids a placeholder slab on first paint).
 */
function LivePulse() {
  const agg = useLiveStats(aggregateLiveStats)
  return (
    <div className="border-sidebar-border bg-sidebar-accent/30 mx-2 mb-1 space-y-1.5 rounded-md border p-2">
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider">
        <span className="text-muted-foreground">All devices</span>
        <span className="text-muted-foreground inline-flex items-center gap-1">
          <span className="bg-status-online relative size-1 rounded-full">
            <span className="bg-status-online absolute inline-flex size-1 animate-ping rounded-full opacity-75" />
          </span>
          Live
        </span>
      </div>
      <MiniAreaChart
        rxHistory={agg.rxHistory}
        txHistory={agg.txHistory}
        height={42}
      />
      <div className="text-muted-foreground flex items-center justify-between text-[10px] tabular-nums">
        <span>
          <span className="text-status-online">↓</span> {formatBps(agg.rxBps)}
        </span>
        <span>
          <span className="text-primary">↑</span> {formatBps(agg.txBps)}
        </span>
      </div>
    </div>
  )
}

function formatBps(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

/**
 * Sidebar collapse/expand toggle. Lives in the footer where the theme
 * picker used to — the theme + user-menu both moved to the top bar.
 */
function CollapseToggle({ collapsed }: { collapsed: boolean }) {
  const { toggleSidebar } = useSidebar()
  const Icon = collapsed
    ? IconLayoutSidebar
    : IconLayoutSidebarLeftCollapse
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={toggleSidebar}
          tooltip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon className="size-4" />
          <span>{collapsed ? "Expand" : "Collapse"}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
