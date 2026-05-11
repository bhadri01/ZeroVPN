import { useEffect } from "react"
import { Navigate } from "react-router"

import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, me } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function useBootstrapAuth() {
  const { setUser, setLoading } = useAuth()

  useEffect(() => {
    let alive = true
    let attempt = 0
    setLoading(true)

    const tryMe = () => {
      me()
        .then((u) => {
          if (alive) {
            setUser(u)
            setLoading(false)
          }
        })
        .catch((e) => {
          if (!alive) return
          if (e instanceof ApiError) {
            // Definitive 401 from the server: the session really is gone,
            // drop the user so the route guard can redirect to /login.
            if (e.status === 401) {
              setUser(null)
              setLoading(false)
              return
            }
            // Other API errors (500, maintenance, etc.): leave the user
            // state alone and stop the loading spinner; ProtectedRoute will
            // route based on whatever was last known.
            setLoading(false)
            return
          }
          // Network / fetch failure (typically the dev api is restarting):
          // back off and retry a few times before giving up. This avoids
          // the "every cargo restart bounces me to /login" loop.
          attempt += 1
          if (attempt <= 4) {
            const delayMs = Math.min(4000, 250 * 2 ** attempt)
            setTimeout(tryMe, delayMs)
            return
          }
          setLoading(false)
        })
    }
    tryMe()

    return () => {
      alive = false
    }
  }, [setUser, setLoading])
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, mustChangePassword } = useAuth()
  if (loading) {
    // Bootstrapping the session cookie — usually < 150 ms. Render a
    // skeleton shell shaped like the dashboard so the layout doesn't
    // shift when the real content mounts.
    return (
      <div className="flex min-h-svh flex-col gap-4 p-6">
        <Skeleton className="h-10 w-64 rounded-none" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Skeleton className="h-20 rounded-none" />
          <Skeleton className="h-20 rounded-none" />
          <Skeleton className="h-20 rounded-none" />
          <Skeleton className="h-20 rounded-none" />
        </div>
        <Skeleton className="h-[260px] rounded-none" />
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
