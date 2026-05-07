import { createBrowserRouter, Outlet } from "react-router"

import { AdminRoute, ProtectedRoute, useBootstrapAuth } from "@/lib/auth-guard"
import { LandingPage } from "@/pages/public/Landing"
import { LoginPage } from "@/pages/public/Login"
import { RegisterPage } from "@/pages/public/Register"
import { AccountPage } from "@/pages/app/Account"
import { DashboardPage } from "@/pages/app/Dashboard"
import { SecurityPage } from "@/pages/app/Security"
import { AdminOverviewPage } from "@/pages/admin/Overview"
import { AuditLogPage } from "@/pages/admin/AuditLog"
import { FailedLoginsPage } from "@/pages/admin/FailedLogins"

function Root() {
  useBootstrapAuth()
  return <Outlet />
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      {
        path: "/app",
        element: (
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/app/security",
        element: (
          <ProtectedRoute>
            <SecurityPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/app/account",
        element: (
          <ProtectedRoute>
            <AccountPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/admin",
        element: (
          <AdminRoute>
            <AdminOverviewPage />
          </AdminRoute>
        ),
      },
      {
        path: "/admin/audit",
        element: (
          <AdminRoute>
            <AuditLogPage />
          </AdminRoute>
        ),
      },
      {
        path: "/admin/failed-logins",
        element: (
          <AdminRoute>
            <FailedLoginsPage />
          </AdminRoute>
        ),
      },
    ],
  },
])
