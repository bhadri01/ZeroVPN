/**
 * First-login force-change-password screen. Reached when the login API
 * returns `must_change_password: true` — the user signed in with a
 * bootstrap or admin-issued temporary password and has to pick a real
 * one before the rest of the app unlocks.
 *
 * Posts to `/me/change-password` directly: the user is already
 * authenticated (their session is real, just gated by the
 * `mustChangePassword` flag) and they know their current password (it
 * was just used to sign in), so there's no reason to detour through
 * the forgot-password email loop. The endpoint clears
 * `must_change_password` server-side as part of `update_password`.
 */
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router"
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
import { ApiError, changePassword, logout } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const reset = useAuth((s) => s.reset)
  const setMustChangePassword = useAuth((s) => s.setMustChangePassword)

  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")

  const m = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      // Clear the gate flag client-side; ProtectedRoute will stop
      // redirecting here on the next render so the user lands in /app.
      setMustChangePassword(false)
      toast.success("Password updated")
      navigate("/app", { replace: true })
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const tooShort = next.length > 0 && next.length < 12
  const mismatch = confirm.length > 0 && next !== confirm
  const sameAsCurrent =
    current.length > 0 && next.length > 0 && current === next
  const canSubmit =
    !m.isPending &&
    current.length > 0 &&
    next.length >= 12 &&
    next === confirm &&
    current !== next

  const handleSignOut = async () => {
    try {
      await logout()
    } catch {
      /* ignore — UI must drop session regardless */
    }
    reset()
    navigate("/login")
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    m.mutate()
  }

  return (
    <AuthShell>
      <AuthForm onSubmit={onSubmit}>
        <AuthHeading eyebrow="— · Change password">
          Set a new password.
        </AuthHeading>

        <p className="text-muted-foreground text-sm leading-relaxed">
          You're signed in with a bootstrap or temporary password. Pick a
          new one to continue
          {user?.email && (
            <>
              {" as "}
              <span className="text-foreground font-medium">{user.email}</span>
            </>
          )}
          .
        </p>

        <Field
          id="cp-current"
          label="Current password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          autoFocus
        />
        <Field
          id="cp-new"
          label="New password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={tooShort ? "Minimum 12 characters" : undefined}
          invalid={tooShort || sameAsCurrent}
        />
        <Field
          id="cp-confirm"
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          hint={mismatch ? "Passwords don't match" : undefined}
          invalid={mismatch}
        />

        {sameAsCurrent && (
          <p className="text-status-degraded font-mono text-[11px]">
            New password must differ from your current one.
          </p>
        )}

        <Button type="submit" disabled={!canSubmit} size="lg">
          {m.isPending ? "Saving…" : "Change password"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void handleSignOut()}
        >
          Sign out
        </Button>

        <AuthFooterRule />
      </AuthForm>
    </AuthShell>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
  invalid,
  autoFocus,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  hint?: string
  invalid?: boolean
  autoFocus?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        className="font-mono"
      />
      {hint && (
        <p className="text-status-degraded font-mono text-[11px]">{hint}</p>
      )}
    </div>
  )
}
