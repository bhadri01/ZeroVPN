import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconCopy, IconDownload, IconLogout } from "@tabler/icons-react"
import { motion } from "motion/react"
import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { Kbd, Panel, Pill } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
import {
  ApiError,
  changePassword,
  revokeOtherSessions,
  totpDisable,
  totpEnable,
  totpSetup,
} from "@/lib/api"
import { useAuth } from "@/stores/auth"

/** Security-management content embedded by the unified `/app/settings`
 *  page (Security tab). Owns TOTP enrollment, recovery-code download,
 *  and the disable-2FA flow. */
export function SecuritySections() {
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const qc = useQueryClient()

  const [setupData, setSetupData] = useState<{
    secret: string
    qr_svg: string
  } | null>(null)
  const [code, setCode] = useState("")
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  const setupM = useMutation({
    mutationFn: totpSetup,
    onSuccess: (d) => setSetupData({ secret: d.secret, qr_svg: d.qr_svg }),
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const enableM = useMutation({
    mutationFn: () => totpEnable(setupData!.secret, code.trim()),
    onSuccess: (d) => {
      setRecoveryCodes(d.recovery_codes)
      setSetupData(null)
      setCode("")
      // Flip the auth-store flag so the status pill + form swap to
      // the "enabled" state instantly — no round-trip to /me needed.
      if (user) setUser({ ...user, totp_enabled: true })
      void qc.invalidateQueries()
      toast.success("2FA enabled")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const disableM = useMutation({
    mutationFn: (c: string) => totpDisable(c.trim()),
    onSuccess: () => {
      if (user) setUser({ ...user, totp_enabled: false })
      void qc.invalidateQueries()
      toast.success("2FA disabled")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const totpEnabled = user?.totp_enabled ?? false

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Two-factor authentication"
        sub="time-based one-time password (TOTP)"
      >
        {!setupData && !recoveryCodes && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {totpEnabled ? (
                <Pill tone="ok">Enabled</Pill>
              ) : (
                <Pill tone="warn">Disabled</Pill>
              )}
              <span className="text-muted-foreground text-xs">
                {totpEnabled
                  ? "An authenticator app is configured for this account. Sign-ins require a 6-digit code."
                  : "Required for admins. Recommended for everyone."}
              </span>
            </div>

            {totpEnabled ? (
              // 2FA already on — give the user direct access to the
              // disable form (no need to hide it behind a <details>
              // disclosure when this is the only available action).
              <DisableForm
                onSubmit={(c) => disableM.mutate(c)}
                pending={disableM.isPending}
              />
            ) : (
              <div className="flex gap-2">
                <Button
                  onClick={() => setupM.mutate()}
                  disabled={setupM.isPending}
                >
                  {setupM.isPending ? "Setting up…" : "Enable 2FA"}
                </Button>
              </div>
            )}
          </div>
        )}

        {setupData && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-4"
          >
            <p className="text-sm">
              Scan this QR with your authenticator app, then enter the 6-digit
              code below.
            </p>

            {/* Two-column layout: QR locked to a square on the left,
                manual-entry + OTP input stretch to fill the rest on the
                right. Collapses to stacked on narrow viewports so the
                160px QR doesn't crowd the form. The SVG is painted
                directly into the box; the `.zv-qr-box svg` rule scales
                it to fit, overriding the qrcode crate's 256px intrinsic
                size. */}
            <div className="grid items-start gap-5 sm:grid-cols-[auto_1fr]">
              <div
                className="zv-qr-box bg-card size-40 shrink-0"
                dangerouslySetInnerHTML={{ __html: setupData.qr_svg }}
              />

              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label className="zv-eyebrow">Or enter manually</Label>
                  <CopyableCode value={setupData.secret} truncate />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="zv-eyebrow">Verification code</Label>
                  <InputOTP maxLength={6} value={code} onChange={setCode}>
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => enableM.mutate()}
                disabled={enableM.isPending || code.length < 6}
              >
                {enableM.isPending ? "Verifying…" : "Verify & enable"}
              </Button>
              <Button variant="ghost" onClick={() => setSetupData(null)}>
                Cancel
              </Button>
            </div>
          </motion.div>
        )}

        {recoveryCodes && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-3"
          >
            <div>
              <p className="text-sm font-medium">
                Save these recovery codes — they're shown only once.
              </p>
              <p className="text-muted-foreground font-mono text-xs">
                Each code can be used once if you lose your authenticator.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {recoveryCodes.map((c) => (
                <Kbd key={c} className="text-center">
                  {c}
                </Kbd>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(recoveryCodes.join("\n"))
                  toast.success("Recovery codes copied")
                }}
              >
                <IconCopy className="size-3.5" />
                Copy all
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadRecoveryCodes(recoveryCodes, user?.email)
                }
              >
                <IconDownload className="size-3.5" />
                Download .txt
              </Button>
              <Button size="sm" onClick={() => setRecoveryCodes(null)}>
                I've saved them
              </Button>
            </div>
          </motion.div>
        )}
      </Panel>

      <Panel
        title="Active sessions"
        sub="Sign out of every other browser / device this account is open in"
      >
        <SignOutEverywherePanel />
      </Panel>
    </div>
  )
}

/**
 * "Sign out everywhere else" panel. Calls the user-side
 * `revoke-all-sessions` endpoint which bumps the password watermark on
 * the server. Every other open session for this account fails the auth
 * extractor's pw-version check on its very next request and is kicked
 * back to /login. The current session stays alive — the server re-syncs
 * our snapshot in the same call.
 */
function SignOutEverywherePanel() {
  const [open, setOpen] = useState(false)
  const m = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => {
      setOpen(false)
      toast.success("All other sessions signed out")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })
  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">
          Use this if you forgot to sign out somewhere, suspect a session
          you don't recognise, or just rotated your password externally.
          You stay signed in here.
        </p>
        <div>
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={m.isPending}
          >
            <IconLogout className="size-4" />
            Sign out everywhere else
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Sign out of all other sessions?"
        description="Every other open session for your account is invalidated immediately. This session stays active. The action is logged in the audit trail."
        confirmLabel="Sign out everywhere"
        destructive
        pending={m.isPending}
        onConfirm={() => m.mutate()}
      />
    </>
  )
}

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")

  const m = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      setCurrent("")
      setNext("")
      setConfirm("")
      toast.success(
        "Password changed. Any other signed-in sessions will be signed out on their next request.",
      )
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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    m.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Current password"
          id="cp-current"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <div className="sm:col-span-1" />
        <Field
          label="New password"
          id="cp-new"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={tooShort ? "Minimum 12 characters" : undefined}
          invalid={tooShort || sameAsCurrent}
        />
        <Field
          label="Confirm new password"
          id="cp-confirm"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          hint={mismatch ? "Passwords don't match" : undefined}
          invalid={mismatch}
        />
      </div>
      {sameAsCurrent && (
        <p className="text-status-degraded font-mono text-[11px]">
          New password must differ from your current one.
        </p>
      )}
      <div>
        <Button type="submit" disabled={!canSubmit}>
          {m.isPending ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  id,
  value,
  onChange,
  autoComplete,
  hint,
  invalid,
}: {
  label: string
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  hint?: string
  invalid?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        className="font-mono"
      />
      {hint && (
        <p className="text-status-degraded font-mono text-[11px]">{hint}</p>
      )}
    </div>
  )
}

/** Trigger a browser download of the recovery codes as a plain .txt
 *  file. We render the codes as a Blob, build an `<a download>`,
 *  click it programmatically, then revoke the object URL. No copy is
 *  retained server-side past this single response; the user *must*
 *  save them now. Filename includes a date stamp + the user's email
 *  local-part so multiple downloads (e.g. testing) don't collide in
 *  the Downloads folder. */
function downloadRecoveryCodes(codes: string[], email: string | undefined) {
  const today = new Date().toISOString().slice(0, 10)
  const localPart = email?.split("@")[0]?.replace(/[^a-z0-9_-]/gi, "") || "user"
  const filename = `zerovpn-recovery-codes-${localPart}-${today}.txt`
  const body = [
    "ZeroVPN — Two-Factor Authentication Recovery Codes",
    `Account: ${email ?? "(unknown)"}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Each code below can be used ONCE to sign in if you lose access to",
    "your authenticator app. Treat them like passwords — store them",
    "somewhere safe (password manager, encrypted note, printed copy in",
    "a desk drawer). Anyone with one of these codes can sign in as you.",
    "",
    ...codes,
    "",
  ].join("\n")
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  toast.success("Recovery codes downloaded")
}

function DisableForm({
  onSubmit,
  pending,
}: {
  onSubmit: (code: string) => void
  pending?: boolean
}) {
  const [c, setC] = useState("")
  return (
    <div className="border-border mt-1 flex flex-col gap-2 border-l pl-3">
      <p className="text-muted-foreground font-mono text-[11px]">
        Enter a current authenticator code to confirm. Recovery codes also
        work here.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          value={c}
          onChange={(e) => setC(e.target.value)}
          placeholder="6-digit code"
          autoComplete="one-time-code"
          inputMode="numeric"
          className="w-44 font-mono"
        />
        <Button
          size="sm"
          variant="destructive"
          onClick={() => onSubmit(c)}
          disabled={pending || c.length < 6}
        >
          {pending ? "Disabling…" : "Disable 2FA"}
        </Button>
      </div>
    </div>
  )
}
