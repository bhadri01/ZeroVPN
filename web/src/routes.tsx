import { createBrowserRouter } from "react-router"

import { LandingPage } from "@/pages/public/Landing"
import { LoginPage } from "@/pages/public/Login"
import { RegisterPage } from "@/pages/public/Register"
import { DashboardPage } from "@/pages/app/Dashboard"
import { AdminOverviewPage } from "@/pages/admin/Overview"

export const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/app", element: <DashboardPage /> },
  { path: "/admin", element: <AdminOverviewPage /> },
])
