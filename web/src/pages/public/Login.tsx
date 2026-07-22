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
import {
  ApiError,
  getMyPreferences,
  googleStartUrl,
  landingPath,
  login,
  resendVerify,
} from "@/lib/api"
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
      // Honor the user's saved "default landing" preference. Best-effort:
      // if the prefs fetch fails we just fall back to the dashboard.
      const prefs = await getMyPreferences().catch(() => null)
      navigate(prefs ? landingPath(prefs.default_landing) : "/app")
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

          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              window.location.href = googleStartUrl
            }}
          >
            <GoogleGlyph />
            Continue with Google
          </Button>

          <div className="text-muted-foreground flex items-center gap-3 text-[11px]">
            <div className="bg-border h-px flex-1" />
            <span className="font-mono uppercase tracking-wider">or</span>
            <div className="bg-border h-px flex-1" />
          </div>

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

          <AuthFooterRule />
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

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" className="mr-1 h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}
