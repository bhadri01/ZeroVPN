import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import {
  AuthForm,
  AuthFooterRule,
  AuthHeading,
  AuthShell,
} from "@/components/layout/AuthShell"
import { Kbd } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, forgotPassword } from "@/lib/api"

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await forgotPassword(email.trim())
      setDone(true)
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
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
              If an account with that email exists, we've emailed a reset
              link. In dev, check MailHog at{" "}
              <Kbd>:8025</Kbd>.
            </p>
            <Button asChild>
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
                If the address exists, a token-link will be sent.
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
