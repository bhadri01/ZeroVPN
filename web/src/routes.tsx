import { createBrowserRouter, Outlet } from "react-router"

import { AdminRoute, ProtectedRoute, useBootstrapAuth } from "@/lib/auth-guard"
import { LandingPage } from "@/pages/public/Landing"
import { LoginPage } from "@/pages/public/Login"
import { RegisterPage } from "@/pages/public/Register"
import { DashboardPage } from "@/pages/app/Dashboard"
import { AdminOverviewPage } from "@/pages/admin/Overview"

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
        path: "/admin",
        element: (
          <AdminRoute>
            <AdminOverviewPage />
          </AdminRoute>
        ),
      },
    ],
  },
])
