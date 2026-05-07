import { lazy, Suspense } from "react"
import { createBrowserRouter, Outlet } from "react-router"

import { MaintenanceBanner } from "@/components/MaintenanceBanner"
import { AdminRoute, ProtectedRoute, useBootstrapAuth } from "@/lib/auth-guard"
import { LandingPage } from "@/pages/public/Landing"
import { LoginPage } from "@/pages/public/Login"
import { RegisterPage } from "@/pages/public/Register"
import { ForgotPasswordPage } from "@/pages/public/ForgotPassword"
import { ResetPasswordPage } from "@/pages/public/ResetPassword"
import { VerifyEmailPage } from "@/pages/public/VerifyEmail"
import { DashboardPage } from "@/pages/app/Dashboard"

// Code-split everything past the dashboard. Lazy-loaded chunks fetch on
// first navigation, keeping the entry bundle small.
const SecurityPage = lazy(() =>
  import("@/pages/app/Security").then((m) => ({ default: m.SecurityPage })),
)
const AccountPage = lazy(() =>
  import("@/pages/app/Account").then((m) => ({ default: m.AccountPage })),
)
const ApiTokensPage = lazy(() =>
  import("@/pages/app/ApiTokens").then((m) => ({ default: m.ApiTokensPage })),
)
const DeviceDetailPage = lazy(() =>
  import("@/pages/app/DeviceDetail").then((m) => ({ default: m.DeviceDetailPage })),
)
const ChangePasswordPage = lazy(() =>
  import("@/pages/app/ChangePassword").then((m) => ({ default: m.ChangePasswordPage })),
)
const AdminOverviewPage = lazy(() =>
  import("@/pages/admin/Overview").then((m) => ({ default: m.AdminOverviewPage })),
)
const AuditLogPage = lazy(() =>
  import("@/pages/admin/AuditLog").then((m) => ({ default: m.AuditLogPage })),
)
const FailedLoginsPage = lazy(() =>
  import("@/pages/admin/FailedLogins").then((m) => ({ default: m.FailedLoginsPage })),
)
const WebhooksPage = lazy(() =>
  import("@/pages/admin/Webhooks").then((m) => ({ default: m.WebhooksPage })),
)
const ServersPage = lazy(() =>
  import("@/pages/admin/Servers").then((m) => ({ default: m.ServersPage })),
)

function Suspended({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="text-muted-foreground flex min-h-svh items-center justify-center">
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

function Root() {
  useBootstrapAuth()
  return (
    <>
      <MaintenanceBanner />
      <Outlet />
    </>
  )
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/verify-email", element: <VerifyEmailPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password", element: <ResetPasswordPage /> },
      {
        // Force-change-password screen — outside ProtectedRoute's
        // mustChangePassword redirect so the user can actually reach it.
        path: "/app/change-password",
        element: (
          <Suspended>
            <ChangePasswordPage />
          </Suspended>
        ),
      },
      {
        path: "/app",
        element: (
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/app/devices/:id",
        element: (
          <ProtectedRoute>
            <Suspended>
              <DeviceDetailPage />
            </Suspended>
          </ProtectedRoute>
        ),
      },
      {
        path: "/app/security",
        element: (
          <ProtectedRoute>
            <Suspended>
              <SecurityPage />
            </Suspended>
          </ProtectedRoute>
        ),
      },
      {
        path: "/app/account",
        element: (
          <ProtectedRoute>
            <Suspended>
              <AccountPage />
            </Suspended>
          </ProtectedRoute>
        ),
      },
      {
        path: "/app/api-tokens",
        element: (
          <ProtectedRoute>
            <Suspended>
              <ApiTokensPage />
            </Suspended>
          </ProtectedRoute>
        ),
      },
      {
        path: "/admin",
        element: (
          <AdminRoute>
            <Suspended>
              <AdminOverviewPage />
            </Suspended>
          </AdminRoute>
        ),
      },
      {
        path: "/admin/audit",
        element: (
          <AdminRoute>
            <Suspended>
              <AuditLogPage />
            </Suspended>
          </AdminRoute>
        ),
      },
      {
        path: "/admin/failed-logins",
        element: (
          <AdminRoute>
            <Suspended>
              <FailedLoginsPage />
            </Suspended>
          </AdminRoute>
        ),
      },
      {
        path: "/admin/webhooks",
        element: (
          <AdminRoute>
            <Suspended>
              <WebhooksPage />
            </Suspended>
          </AdminRoute>
        ),
      },
      {
        path: "/admin/servers",
        element: (
          <AdminRoute>
            <Suspended>
              <ServersPage />
            </Suspended>
          </AdminRoute>
        ),
      },
    ],
  },
])
