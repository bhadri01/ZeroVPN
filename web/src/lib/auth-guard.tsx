import { useEffect } from "react"
import { Navigate } from "react-router"

import { LogoLoader } from "@/components/swiss"
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
    // Bootstrapping the session cookie — usually < 150 ms. Render the
    // animated brand loader so even sub-second boots show consistent
    // brand chrome instead of skeleton bars.
    return <LogoLoader caption="restoring session" />
  }
  if (!user) return <Navigate to="/login" replace />
  if (mustChangePassword) return <Navigate to="/app/change-password" replace />
  return <>{children}</>
}

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LogoLoader caption="verifying" />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== "admin") return <Navigate to="/app" replace />
  return <>{children}</>
}

/** Gate the /app/devices/{id} route behind the global "Hide device detail"
 *  user-policy toggle. Non-admins get bounced back to the device list when
 *  the policy is on; admins always pass through so they can still inspect
 *  any device. The auth-store snapshot is hydrated from /me, login, and
 *  verify-email, so this works from first paint without an extra fetch. */
export function DeviceDetailRoute({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user)
  if (
    user &&
    user.role !== "admin" &&
    user.user_policy?.hide_device_detail
  ) {
    return <Navigate to="/app/devices" replace />
  }
  return <>{children}</>
}
