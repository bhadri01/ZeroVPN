import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
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
    <AuthShell>
      <AuthForm onSubmit={onSubmit}>
        <AuthHeading eyebrow="— · Reset password">
          Choose a new password.
        </AuthHeading>

        {token.length === 0 ? (
          <p className="text-destructive font-mono text-sm">
            Missing token in URL.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw" className="zv-eyebrow">
                New password
              </Label>
              <Input
                id="pw"
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="new-password"
                autoFocus
                required
              />
              <p
                className={`font-mono text-[11px] ${pw.length > 0 && pw.length < 12 ? "text-destructive" : "text-muted-foreground"}`}
              >
                At least 12 characters · argon2id-hashed.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm" className="zv-eyebrow">
                Confirm
              </Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
              {confirm.length > 0 && pw !== confirm && (
                <p className="text-destructive font-mono text-xs">
                  Passwords don't match.
                </p>
              )}
            </div>
          </>
        )}

        <Button type="submit" disabled={!valid || submitting} size="lg">
          {submitting ? "Updating…" : "Update password"}
        </Button>

        <Link
          to="/login"
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          ← Back to sign in
        </Link>

        <AuthFooterRule />
      </AuthForm>
    </AuthShell>
  )
}
