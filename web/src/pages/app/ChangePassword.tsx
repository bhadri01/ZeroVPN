/**
 * First-login force-change-password screen. Reached when the login API
 * returns `must_change_password: true`. We don't have a generic /me/change-
 * password endpoint yet, so we use the existing `/auth/forgot-password`
 * + `/auth/reset-password` flow to set a new password (the link gets
 * auto-emailed; in dev MailHog catches it).
 */
import {
  IconCircleCheck,
  IconKey,
} from "@tabler/icons-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
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
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <span className="bg-primary/10 text-primary mx-auto mb-3 flex size-9 items-center justify-center rounded-md">
            <IconKey className="size-4" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            Change your password
          </h1>
          <p className="text-muted-foreground text-sm">
            You're signed in with a bootstrap or temporary password.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-4 text-sm">
            {sent ? (
              <div className="bg-status-online/10 text-status-online flex items-start gap-3 rounded-md p-3">
                <IconCircleCheck className="mt-0.5 size-4 shrink-0" />
                <p>
                  We've emailed a password-reset link to{" "}
                  <code className="bg-background/50 rounded px-1">
                    {user?.email}
                  </code>
                  . Click the link, set a new password, then sign in again.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                For security, set a new password before continuing. We'll
                email a one-time reset link to{" "}
                <span className="text-foreground font-medium">
                  {user?.email}
                </span>
                .
              </p>
            )}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            {!sent && (
              <Button
                onClick={handleSendLink}
                disabled={sending}
                className="w-full"
              >
                {sending ? "Sending…" : "Email me a reset link"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full"
            >
              Sign out
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
