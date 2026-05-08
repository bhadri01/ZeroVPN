import { useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ApiError, totpDisable, totpEnable, totpSetup } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function SecurityPage() {
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
    mutationFn: () =>
      totpEnable(setupData!.secret, code.trim()),
    onSuccess: (d) => {
      setRecoveryCodes(d.recovery_codes)
      setSetupData(null)
      setCode("")
      // Refresh /me so totp_enabled flips. (We don't have totp_enabled on
      // the auth store yet — flag to avoid the prompt re-appearing.)
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
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-muted-foreground text-sm">
          Two-factor authentication, recovery codes, and account-protection
          settings.
        </p>
      </div>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Two-factor authentication</h2>
          <p className="text-muted-foreground text-sm">
            Use an authenticator app (Google Authenticator, 1Password, Aegis, etc.)
            to generate a 6-digit code at sign-in.
          </p>

          {!setupData && !recoveryCodes && (
            <div className="space-y-2">
              <Button onClick={() => setupM.mutate()} disabled={setupM.isPending}>
                {setupM.isPending ? "Setting up…" : "Enable 2FA"}
              </Button>

              <details className="text-sm">
                <summary className="cursor-pointer">Disable 2FA</summary>
                <DisableForm onSubmit={(c) => disableM.mutate(c)} />
              </details>
            </div>
          )}

          {setupData && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3 rounded-lg border p-4"
            >
              <p className="text-sm">
                Scan this QR code with your authenticator app, then enter the
                generated 6-digit code below.
              </p>
              <div
                className="bg-white p-2"
                dangerouslySetInnerHTML={{ __html: setupData.qr_svg }}
              />
              <p className="text-muted-foreground text-xs">
                Or enter the secret manually:
                <code className="bg-muted ml-1 rounded px-1 py-0.5 font-mono">
                  {setupData.secret}
                </code>
              </p>
              <div className="flex gap-2">
                <input
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]*"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="border-input bg-background w-32 rounded-md border px-3 py-2 text-sm tabular-nums"
                />
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
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2 rounded-lg border p-4"
            >
              <p className="text-sm font-medium">
                Save these recovery codes — they appear only once.
              </p>
              <p className="text-muted-foreground text-xs">
                Each code can be used once if you lose access to your
                authenticator.
              </p>
              <div className="bg-muted grid grid-cols-2 gap-2 rounded p-3 font-mono text-sm">
                {recoveryCodes.map((c) => (
                  <span key={c}>{c}</span>
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
                  Copy
                </Button>
                <Button size="sm" onClick={() => setRecoveryCodes(null)}>
                  I've saved them
                </Button>
              </div>
            </motion.div>
          )}
        </section>
    </div>
  )
}

function DisableForm({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [c, setC] = useState("")
  return (
    <div className="mt-2 flex gap-2">
      <input
        value={c}
        onChange={(e) => setC(e.target.value)}
        placeholder="Current 6-digit code"
        className="border-input bg-background w-44 rounded-md border px-3 py-2 text-sm"
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
