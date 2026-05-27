import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"

import {
  AuthFooterRule,
  AuthHeading,
  AuthShell,
} from "@/components/layout/AuthShell"
import {
  ApiError,
  googleCallback,
  me,
  type LoginResponse,
  type PublicUser,
} from "@/lib/api"
import { useAuth } from "@/stores/auth"

/**
 * Google's redirect lands here with `code` + `state` query params. We
 * pass them to the backend to finalise the exchange, then drop the user
 * into `/app`. The page is intentionally minimal — no form, no controls
 * — because the API call should complete within a second; anything more
 * elaborate flickers.
 *
 * The OAuth `state` is single-use server-side, so duplicate posts always
 * fail the second one with "invalid or expired state". Two scenarios
 * trigger that without the dedupe below:
 *   1. React StrictMode in dev — mounts the component, runs the effect,
 *      unmounts, remounts a *fresh* instance (refs reset) and runs again.
 *      A `useRef` guard does NOT help across the remount.
 *   2. Browser refresh / back-button to the callback URL — same state
 *      param, already consumed.
 *
 * Module-scope dedupe handles both: an in-flight `Map` shares one promise
 * across the StrictMode remount, and a sessionStorage marker lets a
 * post-success refresh fall through to `/me` + navigate instead of
 * surfacing a misleading error.
 */
const inflight = new Map<string, Promise<LoginResponse>>()
const DONE_KEY_PREFIX = "oauth-state-done:"

export function GoogleCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const setUser = useAuth((s) => s.setUser)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = params.get("code")
    const state = params.get("state")
    const googleError = params.get("error")

    if (googleError) {
      setError(`Google returned: ${googleError}`)
      return
    }
    if (!code || !state) {
      setError("Missing code or state in callback URL")
      return
    }

    let cancelled = false
    const goNext = (user: PublicUser, mustChange = false) => {
      if (cancelled) return
      setUser(user)
      toast.success(`Welcome, ${user.email}`)
      navigate(mustChange ? "/app/change-password" : "/app", { replace: true })
    }
    const fail = (msg: string) => {
      if (cancelled) return
      setError(msg)
      toast.error(msg)
    }

    ;(async () => {
      // Refresh / back-button after a successful exchange: the state has
      // already been consumed server-side, but the cookie is set — hydrate
      // from /me and navigate. If that fails, fall through to the normal
      // error message.
      if (sessionStorage.getItem(DONE_KEY_PREFIX + state)) {
        try {
          const u = await me()
          goNext(u)
        } catch {
          fail("Sign-in session expired — please try again.")
        }
        return
      }

      // Share one network call across StrictMode's double-mount. Whichever
      // mount runs first kicks off the request; the second mount awaits
      // the same promise and both resolve to the same successful response.
      let promise = inflight.get(state)
      if (!promise) {
        promise = googleCallback({ code, state })
        inflight.set(state, promise)
      }

      try {
        const res = await promise
        sessionStorage.setItem(DONE_KEY_PREFIX + state, "1")
        goNext(res.user, res.must_change_password)
      } catch (e) {
        // Drop the failed promise so a manual retry isn't stuck replaying
        // the same error.
        inflight.delete(state)
        fail(
          e instanceof ApiError ? e.message : "Couldn't complete Google sign-in",
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [params, navigate, setUser])

  return (
    <AuthShell>
      {/* Same 360px well + gap-5 stack as <AuthForm> elsewhere — without
          the <form> wrapper since this page has no inputs. Keeps the
          heading, status line, and footer rule aligned with the rest of
          the auth pages instead of stretching the full right column. */}
      <div className="flex w-[360px] max-w-full flex-col gap-5">
        <AuthHeading eyebrow="·· Signing in">
          {error ? "Sign-in failed." : "Finishing up…"}
        </AuthHeading>
        {error ? (
          <p className="text-destructive font-mono text-xs">{error}</p>
        ) : (
          <p className="text-muted-foreground font-mono text-xs">
            Completing Google authentication.
          </p>
        )}
        <AuthFooterRule>
          <button
            type="button"
            onClick={() => navigate("/login", { replace: true })}
            className="hover:text-foreground"
          >
            ← Back to sign in
          </button>
        </AuthFooterRule>
      </div>
    </AuthShell>
  )
}
