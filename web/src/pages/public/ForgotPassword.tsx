import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import {
  AuthForm,
  AuthFooterRule,
  AuthHeading,
  AuthShell,
} from "@/components/layout/AuthShell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, forgotPassword } from "@/lib/api"

/** Seconds between consecutive "send link" submissions for the same
 *  session. Long enough to discourage accidental rapid resends (each
 *  one invalidates the previous token server-side, which would lock a
 *  legitimate user out of their own link). */
const RESEND_COOLDOWN_SEC = 30

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  // Countdown for the resend button on the success state. Reset to
  // RESEND_COOLDOWN_SEC each time the user fires off a new request.
  const [cooldown, setCooldown] = useState(0)
  const tickRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (cooldown <= 0) return
    tickRef.current = window.setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1))
    }, 1000)
    return () => window.clearInterval(tickRef.current)
  }, [cooldown])

  const send = async () => {
    setSubmitting(true)
    try {
      await forgotPassword(email.trim())
      setDone(true)
      setCooldown(RESEND_COOLDOWN_SEC)
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await send()
  }

  return (
    <AuthShell>
      <AuthForm onSubmit={onSubmit}>
        <AuthHeading eyebrow="— · Reset password">
          {done ? "Check your inbox." : "Send me a reset link."}
        </AuthHeading>

        {done ? (
          <>
            <p className="text-sm leading-relaxed">
              If an account exists for{" "}
              <span className="text-foreground font-medium">
                {email.trim()}
              </span>
              , a reset link is on its way. It expires in 1 hour and
              can be used once.
            </p>
            <p className="text-muted-foreground text-[12px] leading-relaxed">
              Didn't get it? Check spam, then resend below. Resending
              invalidates the previous link.
            </p>
            <Button
              type="button"
              onClick={send}
              disabled={submitting || cooldown > 0}
            >
              {submitting
                ? "Sending…"
                : cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : "Resend link"}
            </Button>
            <Button asChild variant="ghost">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="zv-eyebrow">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
              <p className="text-muted-foreground font-mono text-[11px]">
                We'll email a one-time link that expires in 1 hour.
              </p>
            </div>

            <Button type="submit" disabled={submitting} size="lg">
              {submitting ? "Sending…" : "Send link"}
            </Button>

            <Link
              to="/login"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              ← Back to sign in
            </Link>
          </>
        )}

        <AuthFooterRule />
      </AuthForm>
    </AuthShell>
  )
}
