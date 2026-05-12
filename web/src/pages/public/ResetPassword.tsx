import {
  IconAlertTriangle,
  IconCircleCheck,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  ApiError,
  resetPassword,
  verifyResetToken,
  type ResetTokenCheck,
} from "@/lib/api"

type Phase =
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "expired"; reason: ResetTokenCheck["reason"] }
  | { kind: "ready" }
  | { kind: "done" }

const MIN_PW = 12
const MAX_PW = 128

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const [phase, setPhase] = useState<Phase>(() =>
    token.length === 0 ? { kind: "missing" } : { kind: "checking" },
  )
  const [pw, setPw] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Pre-flight the token on mount so the form can render an "expired"
  // state without making the user type a new password first. Re-runs
  // if the user navigates back here with a different token in the URL.
  useEffect(() => {
    if (token.length === 0) {
      setPhase({ kind: "missing" })
      return
    }
    let cancelled = false
    setPhase({ kind: "checking" })
    verifyResetToken(token)
      .then((res) => {
        if (cancelled) return
        if (res.valid) setPhase({ kind: "ready" })
        else setPhase({ kind: "expired", reason: res.reason })
      })
      .catch(() => {
        if (cancelled) return
        // Network / 5xx fall back to "expired" with a generic reason —
        // the user can still retry by reloading.
        setPhase({ kind: "expired", reason: undefined })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const pwTooShort = pw.length > 0 && pw.length < MIN_PW
  const pwTooLong = pw.length > MAX_PW
  const pwMismatch = confirm.length > 0 && pw !== confirm
  const canSubmit =
    phase.kind === "ready" &&
    pw.length >= MIN_PW &&
    pw.length <= MAX_PW &&
    pw === confirm &&
    !submitting

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await resetPassword(token, pw)
      setPhase({ kind: "done" })
    } catch (err) {
      if (err instanceof ApiError) {
        // If the token expired between mount and submit (unusual but
        // possible), reflect that in the page state — don't leave the
        // form sitting there with a stale toast.
        if (err.status === 400) {
          setPhase({ kind: "expired", reason: "expired" })
        } else {
          toast.error(err.message)
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <AuthForm onSubmit={onSubmit}>
        <AuthHeading eyebrow="— · Reset password">
          {phase.kind === "done"
            ? "Password updated."
            : phase.kind === "expired" || phase.kind === "missing"
              ? "Link no longer valid."
              : "Choose a new password."}
        </AuthHeading>

        {phase.kind === "checking" && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-full rounded-none" />
            <Skeleton className="h-9 w-full rounded-none" />
            <Skeleton className="h-10 w-32 rounded-none" />
          </div>
        )}

        {(phase.kind === "missing" || phase.kind === "expired") && (
          <>
            <div className="border-destructive/40 bg-destructive/5 flex items-start gap-3 border p-3">
              <IconAlertTriangle
                className="text-destructive mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <div className="flex flex-col gap-1 text-[13px] leading-relaxed">
                <p className="text-foreground font-medium">
                  {phase.kind === "missing"
                    ? "Missing token in URL."
                    : reasonCopy(phase.reason).title}
                </p>
                <p className="text-muted-foreground">
                  {phase.kind === "missing"
                    ? "Open the reset link directly from the email."
                    : reasonCopy(phase.reason).body}
                </p>
              </div>
            </div>
            <Button asChild>
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
            <Link
              to="/login"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              ← Back to sign in
            </Link>
          </>
        )}

        {phase.kind === "ready" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw" className="zv-eyebrow">
                New password
              </Label>
              <div className="relative">
                <Input
                  id="pw"
                  type={showPw ? "text" : "password"}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  required
                  className="pr-9"
                  aria-invalid={pwTooShort || pwTooLong}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
                  tabIndex={-1}
                >
                  {showPw ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                </button>
              </div>
              <p
                className={`font-mono text-[11px] ${pwTooShort || pwTooLong ? "text-destructive" : "text-muted-foreground"}`}
              >
                {pwTooLong
                  ? `Too long (max ${MAX_PW} chars).`
                  : `At least ${MIN_PW} characters. Stored as an argon2id hash.`}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm" className="zv-eyebrow">
                Confirm
              </Label>
              <Input
                id="confirm"
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                aria-invalid={pwMismatch}
              />
              {pwMismatch && (
                <p className="text-destructive font-mono text-[11px]">
                  Passwords don't match.
                </p>
              )}
            </div>

            <Button type="submit" disabled={!canSubmit} size="lg">
              {submitting ? "Updating…" : "Update password"}
            </Button>

            <Link
              to="/login"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              ← Back to sign in
            </Link>
          </>
        )}

        {phase.kind === "done" && (
          <>
            <div className="border-status-online/40 bg-status-online/5 flex items-start gap-3 border p-3">
              <IconCircleCheck
                className="text-status-online mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <div className="flex flex-col gap-1 text-[13px] leading-relaxed">
                <p className="text-foreground font-medium">
                  Your password is updated.
                </p>
                <p className="text-muted-foreground">
                  Every other signed-in browser was also signed out.
                  Use the new password to sign back in.
                </p>
              </div>
            </div>
            <Button asChild size="lg">
              <Link to="/login">Sign in</Link>
            </Button>
          </>
        )}

        <AuthFooterRule />
      </AuthForm>
    </AuthShell>
  )
}

/** User-facing copy for each reason the server returned when the token
 *  check failed. Kept here so the failure card surfaces a specific
 *  message instead of a generic "expired link". */
function reasonCopy(reason: ResetTokenCheck["reason"] | undefined): {
  title: string
  body: string
} {
  switch (reason) {
    case "expired":
      return {
        title: "This reset link has expired.",
        body: "Reset links are good for 1 hour. Request a fresh one to continue.",
      }
    case "invalid":
      return {
        title: "This reset link is malformed.",
        body: "The token in the URL doesn't look right. Try copying the link again from the email, or request a fresh one.",
      }
    case "wrong_purpose":
      return {
        title: "This link can't reset a password.",
        body: "The token in the URL is for a different verification flow. Request a new password-reset link to continue.",
      }
    default:
      return {
        title: "We couldn't verify this link.",
        body: "It may have been used already or expired. Request a fresh link to continue.",
      }
  }
}
