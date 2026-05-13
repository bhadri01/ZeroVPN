import { lazy } from "react"
import { createBrowserRouter, Outlet } from "react-router"

import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { PublicShell } from "@/components/layout/PublicShell"
import { PublicRouteError, RouteError } from "@/components/RouteError"
import { AdminRoute, ProtectedRoute, useBootstrapAuth } from "@/lib/auth-guard"

// All pages lazy-loaded to keep the entry chunk small. The DashboardLayout
// wraps the lazy load with its own Suspense fallback (skeleton).
const LandingPage = lazy(() =>
  import("@/pages/public/Landing").then((m) => ({ default: m.LandingPage })),
)
const LoginPage = lazy(() =>
  import("@/pages/public/Login").then((m) => ({ default: m.LoginPage })),
)
const RegisterPage = lazy(() =>
  import("@/pages/public/Register").then((m) => ({ default: m.RegisterPage })),
)
const VerifyEmailPage = lazy(() =>
  import("@/pages/public/VerifyEmail").then((m) => ({
    default: m.VerifyEmailPage,
  })),
)
const ForgotPasswordPage = lazy(() =>
  import("@/pages/public/ForgotPassword").then((m) => ({
    default: m.ForgotPasswordPage,
  })),
)
const ResetPasswordPage = lazy(() =>
  import("@/pages/public/ResetPassword").then((m) => ({
    default: m.ResetPasswordPage,
  })),
)

const DashboardPage = lazy(() =>
  import("@/pages/app/Dashboard").then((m) => ({ default: m.DashboardPage })),
)
const DevicesPage = lazy(() =>
  import("@/pages/app/Devices").then((m) => ({ default: m.DevicesPage })),
)
const FinderPage = lazy(() =>
  import("@/pages/app/Finder").then((m) => ({ default: m.FinderPage })),
)
const TopologyPage = lazy(() =>
  import("@/pages/app/Topology").then((m) => ({ default: m.TopologyPage })),
)
const SettingsPage = lazy(() =>
  import("@/pages/app/Settings").then((m) => ({ default: m.SettingsPage })),
)
const DeviceDetailPage = lazy(() =>
  import("@/pages/app/DeviceDetail").then((m) => ({
    default: m.DeviceDetailPage,
  })),
)
const ChangePasswordPage = lazy(() =>
  import("@/pages/app/ChangePassword").then((m) => ({
    default: m.ChangePasswordPage,
  })),
)
const AdminOverviewPage = lazy(() =>
  import("@/pages/admin/Overview").then((m) => ({
    default: m.AdminOverviewPage,
  })),
)
const UsersPage = lazy(() =>
  import("@/pages/admin/Users").then((m) => ({ default: m.UsersPage })),
)
const UserDetailPage = lazy(() =>
  import("@/pages/admin/UserDetail").then((m) => ({
    default: m.UserDetailPage,
  })),
)
const AdminDeviceDetailPage = lazy(() =>
  import("@/pages/admin/DeviceDetail").then((m) => ({
    default: m.AdminDeviceDetailPage,
  })),
)
const AuditLogPage = lazy(() =>
  import("@/pages/admin/AuditLog").then((m) => ({ default: m.AuditLogPage })),
)
const FailedLoginsPage = lazy(() =>
  import("@/pages/admin/FailedLogins").then((m) => ({
    default: m.FailedLoginsPage,
  })),
)
const SessionsPage = lazy(() =>
  import("@/pages/admin/Sessions").then((m) => ({ default: m.SessionsPage })),
)
const AccessLogsPage = lazy(() =>
  import("@/pages/admin/AccessLogs").then((m) => ({
    default: m.AccessLogsPage,
  })),
)
const ServersPage = lazy(() =>
  import("@/pages/admin/Servers").then((m) => ({ default: m.ServersPage })),
)
const ServerDetailPage = lazy(() =>
  import("@/pages/admin/ServerDetail").then((m) => ({
    default: m.ServerDetailPage,
  })),
)
const AdminTopologyPage = lazy(() =>
  import("@/pages/admin/Topology").then((m) => ({
    default: m.AdminTopologyPage,
  })),
)

/**
 * Root: bootstraps auth on mount, then renders the matching outlet
 * (PublicShell for unauthenticated paths, DashboardLayout for protected).
 */
function Root() {
  useBootstrapAuth()
  return <Outlet />
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      // ── Public ─────────────────────────────────────────────────────────
      {
        element: <PublicShell />,
        errorElement: <PublicRouteError />,
        children: [
          { path: "/", element: <LandingPage /> },
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
          { path: "/verify-email", element: <VerifyEmailPage /> },
          { path: "/forgot-password", element: <ForgotPasswordPage /> },
          { path: "/reset-password", element: <ResetPasswordPage /> },
          // Force-change-password lives outside DashboardLayout because
          // ProtectedRoute would redirect us back here in a loop.
          { path: "/app/change-password", element: <ChangePasswordPage /> },
        ],
      },

      // ── App (user) ─────────────────────────────────────────────────────
      {
        element: (
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        ),
        errorElement: <RouteError />,
        children: [
          {
            path: "/app",
            handle: { breadcrumb: "Dashboard" },
            element: <DashboardPage />,
          },
          {
            path: "/app/devices",
            handle: { breadcrumb: "Devices" },
            element: <DevicesPage />,
          },
          {
            path: "/app/devices/:id",
            handle: {
              breadcrumb: "Device",
              parents: [{ label: "Devices", to: "/app/devices" }],
            },
            element: <DeviceDetailPage />,
          },
          {
            path: "/app/topology",
            handle: { breadcrumb: "Topology" },
            element: <TopologyPage />,
          },
          {
            path: "/app/settings",
            handle: { breadcrumb: "Settings" },
            element: <SettingsPage />,
          },
          // ── Admin ──────────────────────────────────────────────────────
          {
            element: (
              <AdminRoute>
                <Outlet />
              </AdminRoute>
            ),
            handle: { breadcrumb: "Admin" },
            children: [
              {
                path: "/admin",
                handle: { breadcrumb: "Overview" },
                element: <AdminOverviewPage />,
              },
              {
                path: "/admin/users",
                handle: { breadcrumb: "Users" },
                element: <UsersPage />,
              },
              {
                path: "/admin/users/:id",
                handle: {
                  breadcrumb: "Detail",
                  parents: [{ label: "Users", to: "/admin/users" }],
                },
                element: <UserDetailPage />,
              },
              {
                path: "/admin/devices/:id",
                handle: {
                  breadcrumb: "Device",
                  parents: [{ label: "Users", to: "/admin/users" }],
                },
                element: <AdminDeviceDetailPage />,
              },
              {
                path: "/admin/audit",
                handle: { breadcrumb: "Audit log" },
                element: <AuditLogPage />,
              },
              {
                path: "/admin/failed-logins",
                handle: { breadcrumb: "Failed logins" },
                element: <FailedLoginsPage />,
              },
              {
                path: "/admin/sessions",
                handle: { breadcrumb: "Sessions" },
                element: <SessionsPage />,
              },
              {
                path: "/admin/access-logs",
                handle: { breadcrumb: "Access logs" },
                element: <AccessLogsPage />,
              },
              {
                path: "/admin/servers",
                handle: { breadcrumb: "Servers" },
                element: <ServersPage />,
              },
              {
                path: "/admin/servers/:id",
                handle: {
                  breadcrumb: "Detail",
                  parents: [{ label: "Servers", to: "/admin/servers" }],
                },
                element: <ServerDetailPage />,
              },
              {
                path: "/admin/topology",
                handle: { breadcrumb: "Topology" },
                element: <AdminTopologyPage />,
              },
              {
                path: "/admin/finder",
                handle: { breadcrumb: "Finder" },
                element: <FinderPage />,
              },
            ],
          },

          // Catch-all inside the authenticated shell so /app/foo and
          // /admin/foo render a branded 404 with the sidebar still visible.
          { path: "*", element: <RouteError /> },
        ],
      },
    ],
  },
])
