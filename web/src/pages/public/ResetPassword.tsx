import { IconKey } from "@tabler/icons-react"
import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
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
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <span className="bg-primary/10 text-primary mx-auto mb-3 flex size-9 items-center justify-center rounded-md">
            <IconKey className="size-4" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            Reset password
          </h1>
          <p className="text-muted-foreground text-sm">
            Choose a new password to finish.
          </p>
        </div>
        <Card>
          <form onSubmit={onSubmit} className="contents">
            <CardContent className="space-y-4">
              {token.length === 0 ? (
                <p className="text-destructive text-sm">
                  Missing token in URL.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="pw">New password</Label>
                    <Input
                      id="pw"
                      type="password"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      autoComplete="new-password"
                      autoFocus
                      required
                    />
                    {pw.length > 0 && pw.length < 12 ? (
                      <p className="text-destructive text-xs">
                        At least 12 characters.
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        At least 12 characters.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm">Confirm new password</Label>
                    <Input
                      id="confirm"
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    {confirm.length > 0 && pw !== confirm && (
                      <p className="text-destructive text-xs">
                        Passwords don't match.
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter className="flex-col gap-3">
              <Button
                type="submit"
                disabled={!valid || submitting}
                className="w-full"
              >
                {submitting ? "Updating…" : "Update password"}
              </Button>
              <Link
                to="/login"
                className="text-muted-foreground hover:text-foreground text-center text-xs"
              >
                Back to sign in
              </Link>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
