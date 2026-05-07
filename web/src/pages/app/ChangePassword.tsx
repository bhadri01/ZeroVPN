/**
 * First-login force-change-password screen. Reached when the login API
 * returns `must_change_password: true`. We don't have a generic /me/change-
 * password endpoint yet, so we use the existing `/auth/forgot-password`
 * + `/auth/reset-password` flow to set a new password (the link gets
 * auto-emailed; in dev MailHog catches it).
 *
 * For the UX, we just point the user at the email they just received and
 * let them complete the reset.
 */
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ApiError, forgotPassword, logout } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const reset = useAuth((s) => s.reset)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSendLink = async () => {
    if (!user) return
    setSending(true)
    try {
      await forgotPassword(user.email)
      setSent(true)
      toast.success("Reset email sent — check your inbox (or MailHog in dev)")
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
    } finally {
      setSending(false)
    }
  }

  const handleSignOut = async () => {
    await logout()
    reset()
    navigate("/login")
  }

  return (
    <div className="bg-background text-foreground min-h-svh">
      <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Change your password</h1>
        <p className="text-muted-foreground text-sm">
          You're signed in with the bootstrap admin password. For security, you
          need to set a new password before continuing.
        </p>

        {sent ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            We've emailed a password-reset link to <code>{user?.email}</code>.
            Click the link, choose a new password, then sign in again.
          </p>
        ) : (
          <Button onClick={handleSendLink} disabled={sending}>
            {sending ? "Sending…" : "Email me a reset link"}
          </Button>
        )}

        <Button variant="ghost" onClick={handleSignOut}>
          Sign out
        </Button>
      </main>
    </div>
  )
}
