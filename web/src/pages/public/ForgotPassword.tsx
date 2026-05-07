import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
    <div className="flex min-h-svh items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Forgot password</h1>
        {done ? (
          <>
            <p className="text-sm">
              If an account with that email exists, we've emailed a reset link.
              Check your inbox (or MailHog at <code>:8025</code> in dev).
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Enter your email and we'll send a reset link. The link expires
              in 1 hour.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              placeholder="you@example.com"
              required
            />
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Sending…" : "Send reset link"}
            </Button>
            <div className="text-muted-foreground text-center text-sm">
              <Link to="/login" className="underline">
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
