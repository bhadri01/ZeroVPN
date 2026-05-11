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
  IconUser,
  IconUserShield,
  IconUsers,
  IconWebhook,
} from "@tabler/icons-react"
import { useMemo } from "react"
import { Link, NavLink, useLocation } from "react-router"

import { MiniAreaChart } from "@/components/charts/LazyMiniAreaChart"
import { LiveDot, Wordmark } from "@/components/swiss"
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
import { cn } from "@/lib/utils"
import { useAuth } from "@/stores/auth"
import { aggregateLiveStats, useLiveStats } from "@/stores/liveStats"

type NavEntry = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Mono key hint shown to the right of the label, e.g. "D". */
  k?: string
  end?: boolean
}

const WORKSPACE: NavEntry[] = [
  { to: "/app", label: "Dashboard", icon: IconLayoutDashboard, k: "D", end: true },
  { to: "/app/devices", label: "Devices", icon: IconDevices, k: "V" },
  { to: "/app/bandwidth", label: "Bandwidth", icon: IconChartLine, k: "B" },
]

const ACCOUNT: NavEntry[] = [
  { to: "/app/security", label: "Security", icon: IconShield, k: "S" },
  { to: "/app/api-tokens", label: "API tokens", icon: IconKey, k: "T" },
  { to: "/app/account", label: "Account", icon: IconUser, k: "A" },
]

const ADMIN: NavEntry[] = [
  { to: "/admin", label: "Overview", icon: IconUserShield, k: "1", end: true },
  { to: "/admin/users", label: "Users", icon: IconUsers, k: "2" },
  { to: "/admin/audit", label: "Audit log", icon: IconClipboardList, k: "3" },
  { to: "/admin/failed-logins", label: "Failed logins", icon: IconCircleDashedX, k: "4" },
  { to: "/admin/webhooks", label: "Webhooks", icon: IconWebhook, k: "5" },
  { to: "/admin/servers", label: "Servers", icon: IconRouter, k: "6" },
]

export function AppSidebar() {
  const user = useAuth((s) => s.user)
  const { state } = useSidebar()
  const collapsed = state === "collapsed"

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-sidebar-border h-12 justify-center border-b px-4 py-0">
        <Link
          to="/app"
          className="flex h-12 items-center font-mono text-xs font-medium tracking-[0.04em]"
        >
          {collapsed ? <Wordmark size={11} /> : <Wordmark size={12} />}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.1em]">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <NavList entries={WORKSPACE} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.1em]">
            Account
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <NavList entries={ACCOUNT} />
          </SidebarGroupContent>
        </SidebarGroup>

        {user?.role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.1em]">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <NavList entries={ADMIN} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-0">
        {!collapsed && <LivePulse />}
        <CollapseToggle collapsed={collapsed} />
        {!collapsed && <VersionRow />}
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
        const isActive = entry.end
          ? location.pathname === entry.to
          : location.pathname.startsWith(entry.to)
        return (
          <SidebarMenuItem key={entry.to}>
            <SidebarMenuButton
              asChild
              isActive={isActive}
              tooltip={entry.label}
              className={cn(
                "relative h-8 rounded-none text-[13px]",
                isActive &&
                  "before:bg-primary before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:content-['']",
              )}
            >
              <NavLink to={entry.to} end={entry.end}>
                <Icon className="size-4" />
                <span>{entry.label}</span>
                {entry.k && (
                  <span className="text-muted-foreground/70 ml-auto font-mono text-[10px]">
                    ⌘{entry.k}
                  </span>
                )}
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
  // Select the stable `devices` reference and memoize the aggregate.
  // Calling `useLiveStats(aggregateLiveStats)` directly would return a
  // new object on every read and trip `useSyncExternalStore` into the
  // "snapshot is not cached" infinite loop (React error #185).
  const devices = useLiveStats((s) => s.devices)
  const agg = useMemo(() => aggregateLiveStats(devices), [devices])
  return (
    <div className="border-sidebar-border mx-2 mb-1 space-y-1.5 border p-2">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.08em]">
        <span className="text-muted-foreground">All devices</span>
        <span className="text-muted-foreground inline-flex items-center gap-1.5">
          <LiveDot />
          Live
        </span>
      </div>
      <MiniAreaChart
        rxHistory={agg.rxHistory}
        txHistory={agg.txHistory}
        height={42}
      />
      <div className="text-muted-foreground flex items-center justify-between font-mono text-[10px] tabular-nums">
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

function VersionRow() {
  return (
    <div className="text-muted-foreground flex items-center justify-between px-3 py-2 font-mono text-[10px]">
      <span>v1.0.20240310</span>
      <span className="inline-flex items-center gap-1.5">
        <LiveDot />
        live
      </span>
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
  const Icon = collapsed ? IconLayoutSidebar : IconLayoutSidebarLeftCollapse
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={toggleSidebar}
          tooltip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="h-8 rounded-none text-[13px]"
        >
          <Icon className="size-4" />
          <span>{collapsed ? "Expand" : "Collapse"}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
