import { useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useState } from "react"
import { toast } from "sonner"

import { CopyableCode } from "@/components/CopyableCode"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
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
    <div className="space-y-6">
      <PageHeader
        title="Security"
        description="Two-factor authentication, recovery codes, and account-protection settings."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Two-factor authentication
          </CardTitle>
          <CardDescription>
            Use an authenticator app (Google Authenticator, 1Password, Aegis,
            etc.) to generate a 6-digit code on sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!setupData && !recoveryCodes && (
            <>
              <Button
                onClick={() => setupM.mutate()}
                disabled={setupM.isPending}
              >
                {setupM.isPending ? "Setting up…" : "Enable 2FA"}
              </Button>
              <details className="text-sm">
                <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
                  Already enabled? Disable 2FA
                </summary>
                <DisableForm onSubmit={(c) => disableM.mutate(c)} />
              </details>
            </>
          )}

          {setupData && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="space-y-3"
            >
              <p className="text-sm">
                Scan this QR code with your authenticator app, then enter the
                6-digit code below.
              </p>
              <div className="border-border inline-flex rounded-md border bg-white p-2">
                <span
                  className="block size-40"
                  dangerouslySetInnerHTML={{ __html: setupData.qr_svg }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Or enter manually</Label>
                <CopyableCode value={setupData.secret} truncate />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Verification code</Label>
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
              className="space-y-3"
            >
              <div>
                <p className="text-sm font-medium">
                  Save these recovery codes — they're shown only once.
                </p>
                <p className="text-muted-foreground text-xs">
                  Each code can be used once if you lose your authenticator.
                </p>
              </div>
              <div className="bg-muted/50 grid grid-cols-2 gap-2 rounded-md border p-3 font-mono text-sm">
                {recoveryCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      recoveryCodes.join("\n"),
                    )
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
        </CardContent>
      </Card>
    </div>
  )
}

function DisableForm({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [c, setC] = useState("")
  return (
    <div className="border-border mt-3 flex flex-wrap gap-2 rounded-md border-l-2 pl-3">
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
