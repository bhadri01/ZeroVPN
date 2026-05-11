/**
 * First-login force-change-password screen. Reached when the login API
 * returns `must_change_password: true`. We don't have a generic /me/change-
 * password endpoint yet, so we use the existing `/auth/forgot-password`
 * + `/auth/reset-password` flow to set a new password (the link gets
 * auto-emailed; in dev MailHog catches it).
 */
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import {
  AuthForm,
  AuthFooterRule,
  AuthHeading,
  AuthShell,
} from "@/components/layout/AuthShell"
import { Banner, Kbd } from "@/components/swiss"
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
      toast.success("Reset email sent")
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
    <AuthShell>
      <AuthForm>
        <AuthHeading eyebrow="— · Change password">
          Set a new password.
        </AuthHeading>

        {sent ? (
          <Banner tone="info" tag="SENT">
            We've emailed a reset link to <Kbd>{user?.email}</Kbd>. Click the
            link, set a new password, then sign in again.
          </Banner>
        ) : (
          <p className="text-sm leading-relaxed">
            You're signed in with a bootstrap or temporary password. We'll
            email a one-time reset link to{" "}
            <span className="text-foreground font-medium">{user?.email}</span>.
          </p>
        )}

        {!sent && (
          <Button onClick={handleSendLink} disabled={sending} size="lg">
            {sending ? "Sending…" : "Email me a reset link"}
          </Button>
        )}
        <Button variant="ghost" onClick={handleSignOut}>
          Sign out
        </Button>

        <AuthFooterRule />
      </AuthForm>
    </AuthShell>
  )
}
