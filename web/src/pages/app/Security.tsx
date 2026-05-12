import { useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useState } from "react"
import { toast } from "sonner"

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
      if (user) setUser({ ...user })
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
      toast.success("2FA disabled")
      void qc.invalidateQueries()
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Two-factor authentication"
        sub="time-based one-time password (TOTP)"
      >
        {!setupData && !recoveryCodes && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Pill tone="warn">Status unknown</Pill>
              <span className="text-muted-foreground text-xs">
                Required for admins. Recommended for everyone.
              </span>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setupM.mutate()} disabled={setupM.isPending}>
                {setupM.isPending ? "Setting up…" : "Enable 2FA"}
              </Button>
            </div>
            <details className="text-sm">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer font-mono text-[12px]">
                Already enabled? Disable 2FA ↗
              </summary>
              <DisableForm onSubmit={(c) => disableM.mutate(c)} />
            </details>
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
            <div className="zv-qr-box bg-card inline-flex">
              <span
                className="block size-40"
                dangerouslySetInnerHTML={{ __html: setupData.qr_svg }}
              />
            </div>
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
            <div className="flex gap-2">
              <Button
                onClick={() => enableM.mutate()}
                disabled={enableM.isPending || code.length < 6}
              >
                Verify & enable
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
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(recoveryCodes.join("\n"))
                  toast.success("Recovery codes copied")
                }}
              >
                Copy all
              </Button>
              <Button size="sm" onClick={() => setRecoveryCodes(null)}>
                I've saved them
              </Button>
            </div>
          </motion.div>
        )}
      </Panel>

      <Panel title="Password" sub="argon2id · m=64MB · t=3 · p=4">
        <ChangePasswordForm />
      </Panel>
    </div>
  )
}

function ChangePasswordForm() {
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

function DisableForm({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [c, setC] = useState("")
  return (
    <div className="border-border mt-3 flex flex-wrap gap-2 border-l pl-3">
      <Input
        value={c}
        onChange={(e) => setC(e.target.value)}
        placeholder="Current 6-digit code"
        className="w-44 font-mono"
      />
      <Button
        size="sm"
        variant="destructive"
        onClick={() => onSubmit(c)}
        disabled={c.length < 6}
      >
        Disable 2FA
      </Button>
    </div>
  )
}
