import { createBrowserRouter, Outlet } from "react-router"

import { MaintenanceBanner } from "@/components/MaintenanceBanner"
import { AdminRoute, ProtectedRoute, useBootstrapAuth } from "@/lib/auth-guard"
import { LandingPage } from "@/pages/public/Landing"
import { LoginPage } from "@/pages/public/Login"
import { RegisterPage } from "@/pages/public/Register"
import { VerifyEmailPage } from "@/pages/public/VerifyEmail"
import { ForgotPasswordPage } from "@/pages/public/ForgotPassword"
import { ResetPasswordPage } from "@/pages/public/ResetPassword"
import { AccountPage } from "@/pages/app/Account"
import { ApiTokensPage } from "@/pages/app/ApiTokens"
import { DashboardPage } from "@/pages/app/Dashboard"
import { DeviceDetailPage } from "@/pages/app/DeviceDetail"
import { SecurityPage } from "@/pages/app/Security"
import { AdminOverviewPage } from "@/pages/admin/Overview"
import { AuditLogPage } from "@/pages/admin/AuditLog"
import { FailedLoginsPage } from "@/pages/admin/FailedLogins"

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
            <DeviceDetailPage />
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
        path: "/app/api-tokens",
        element: (
          <ProtectedRoute>
            <ApiTokensPage />
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
