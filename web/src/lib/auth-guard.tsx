import { useEffect } from "react"
import { Navigate } from "react-router"

import { ApiError, me } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function useBootstrapAuth() {
  const { setUser, setLoading } = useAuth()

  useEffect(() => {
    let alive = true
    setLoading(true)
    me()
      .then((u) => {
        if (alive) setUser(u)
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          if (alive) setUser(null)
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [setUser, setLoading])
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, mustChangePassword } = useAuth()
  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center">
        Loading…
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (mustChangePassword) return <Navigate to="/app/change-password" replace />
  return <>{children}</>
}

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== "admin") return <Navigate to="/app" replace />
  return <>{children}</>
}
