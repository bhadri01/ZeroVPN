import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ApiError, resetPassword } from "@/lib/api"

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get("token") ?? ""
  const [pw, setPw] = useState("")
  const [confirm, setConfirm] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const valid =
    pw.length >= 12 && pw.length <= 128 && pw === confirm && token.length > 0

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    try {
      await resetPassword(token, pw)
      toast.success("Password updated. Sign in with your new password.")
      navigate("/login")
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Reset password</h1>
        {token.length === 0 ? (
          <p className="text-destructive text-sm">Missing token in URL.</p>
        ) : (
          <>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              autoFocus
              placeholder="New password (min 12 chars)"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              required
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="Confirm new password"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              required
            />
            {pw.length > 0 && pw.length < 12 && (
              <p className="text-destructive text-xs">
                Password must be at least 12 characters.
              </p>
            )}
            {confirm.length > 0 && pw !== confirm && (
              <p className="text-destructive text-xs">Passwords don't match.</p>
            )}
            <Button type="submit" disabled={!valid || submitting} className="w-full">
              {submitting ? "Updating…" : "Update password"}
            </Button>
          </>
        )}
        <div className="text-muted-foreground text-center text-sm">
          <Link to="/login" className="underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  )
}
