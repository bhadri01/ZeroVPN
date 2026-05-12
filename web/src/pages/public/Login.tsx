import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import {
  AuthForm,
  AuthFooterRule,
  AuthHeading,
  AuthShell,
} from "@/components/layout/AuthShell"
import { Kbd } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
import { ApiError, login, resendVerify } from "@/lib/api"
import { useAuth } from "@/stores/auth"

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password required"),
})
type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const navigate = useNavigate()
  const setUser = useAuth((s) => s.setUser)
  const [needsTotp, setNeedsTotp] = useState(false)
  const [pending, setPending] = useState<{
    email: string
    password: string
  } | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const finishLogin = async (creds: {
    email: string
    password: string
    totp_code?: string
  }) => {
    setUnverifiedEmail(null)
    try {
      const res = await login(creds)
      if (res.totp_required) {
        setNeedsTotp(true)
        setPending({ email: creds.email, password: creds.password })
        return
      }
      setUser(res.user)
      toast.success(`Welcome, ${res.user.email}`)
      navigate("/app")
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 429)
          toast.error("Too many attempts. Try again in a few minutes.")
        else if (e.status === 401)
          toast.error(needsTotp ? "Invalid 2FA code" : "Invalid email or password")
        else if (e.status === 403 && e.code === "email_not_verified") {
          setUnverifiedEmail(creds.email)
          toast.error("Verify your email to continue")
        } else if (e.status === 403)
          toast.error("Account suspended")
        else toast.error(e.message)
      } else {
        toast.error("Login failed")
      }
    }
  }

  const onResend = async () => {
    if (!unverifiedEmail) return
    setResending(true)
    try {
      await resendVerify(unverifiedEmail)
      toast.success("Verification email re-sent")
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
      else toast.error("Couldn't resend the email")
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthShell>
      {!needsTotp ? (
        <AuthForm onSubmit={handleSubmit((v) => finishLogin(v))}>
          <AuthHeading eyebrow="01 · Sign in">Welcome back.</AuthHeading>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="zv-eyebrow">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            {errors.email && (
              <p className="text-destructive font-mono text-xs">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="zv-eyebrow">
                Password
              </Label>
              <Link
                to="/forgot-password"
                className="text-muted-foreground hover:text-foreground font-mono text-[11px]"
              >
                Forgot ↗
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            {errors.password && (
              <p className="text-destructive font-mono text-xs">
                {errors.password.message}
              </p>
            )}
          </div>

          {unverifiedEmail && (
            <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-2 border p-3">
              <p className="text-destructive font-mono text-xs">
                Your email isn't verified yet. Click the link we sent to{" "}
                <span className="font-semibold">{unverifiedEmail}</span> to
                activate your account.
              </p>
              <button
                type="button"
                onClick={onResend}
                disabled={resending}
                className="text-foreground self-start font-mono text-[11px] underline disabled:opacity-50"
              >
                {resending ? "Resending…" : "Resend verification email →"}
              </button>
            </div>
          )}

          <Button type="submit" disabled={isSubmitting} size="lg">
            {isSubmitting ? "Verifying…" : "Continue"}
            <Kbd className="ml-2">↵</Kbd>
          </Button>

          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>New here?</span>
            <Link
              to="/register"
              className="text-foreground hover:underline"
            >
              Create an account ↗
            </Link>
          </div>

          <AuthFooterRule>
            <Link to="/" className="hover:text-foreground">
              ← Home
            </Link>
          </AuthFooterRule>
        </AuthForm>
      ) : (
        <AuthForm
          onSubmit={(e) => {
            e.preventDefault()
            if (pending) void finishLogin({ ...pending, totp_code: totpCode.trim() })
          }}
        >
          <AuthHeading eyebrow="02 · Two-factor">
            Enter the 6-digit code.
          </AuthHeading>

          <div className="flex flex-col gap-1.5">
            <Label className="zv-eyebrow">6-digit code</Label>
            <InputOTP
              maxLength={6}
              value={totpCode}
              onChange={(v) => setTotpCode(v)}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            <p className="text-muted-foreground font-mono text-[11px]">
              From your authenticator app or recovery code
            </p>
          </div>

          <Button type="submit" disabled={totpCode.length < 6} size="lg">
            Verify
            <Kbd className="ml-2">↵</Kbd>
          </Button>

          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setNeedsTotp(false)
                setTotpCode("")
                setPending(null)
              }}
              className="text-foreground hover:underline"
            >
              ← Back
            </button>
          </div>

          <AuthFooterRule />
        </AuthForm>
      )}
    </AuthShell>
  )
}
