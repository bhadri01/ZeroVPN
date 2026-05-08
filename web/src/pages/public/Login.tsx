import { zodResolver } from "@hookform/resolvers/zod"
import { IconShield } from "@tabler/icons-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
import { ApiError, login } from "@/lib/api"
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
    try {
      const res = await login(creds)
      if (res.totp_required) {
        setNeedsTotp(true)
        setPending({ email: creds.email, password: creds.password })
        return
      }
      setUser(res.user)
      toast.success(`Welcome, ${res.user.email}`)
      navigate(res.user.role === "admin" ? "/admin" : "/app")
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 429)
          toast.error("Too many attempts. Try again in a few minutes.")
        else if (e.status === 401)
          toast.error(needsTotp ? "Invalid 2FA code" : "Invalid email or password")
        else if (e.status === 403)
          toast.error("Account suspended or pending verification")
        else toast.error(e.message)
      } else {
        toast.error("Login failed")
      }
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <span className="bg-primary/10 text-primary mx-auto mb-3 flex size-9 items-center justify-center rounded-md">
            <IconShield className="size-4" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="text-muted-foreground text-sm">
            Sign in to your ZeroVPN account
          </p>
        </div>

        <Card>
          {!needsTotp ? (
            <form
              onSubmit={handleSubmit((v) => finishLogin(v))}
              className="contents"
            >
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    aria-invalid={!!errors.email}
                    {...register("email")}
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs">
                      {errors.email.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      to="/forgot-password"
                      className="text-muted-foreground hover:text-foreground text-xs"
                    >
                      Forgot?
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
                    <p className="text-destructive text-xs">
                      {errors.password.message}
                    </p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-3">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? "Signing in…" : "Sign in"}
                </Button>
                <p className="text-muted-foreground text-center text-xs">
                  No account?{" "}
                  <Link
                    to="/register"
                    className="text-foreground font-medium hover:underline"
                  >
                    Create one
                  </Link>
                </p>
              </CardFooter>
            </form>
          ) : (
            <>
              <CardHeader>
                <CardTitle className="text-base">Two-factor code</CardTitle>
                <CardDescription>
                  Enter the 6-digit code from your authenticator app, or an
                  8-character recovery code.
                </CardDescription>
              </CardHeader>
              <CardContent>
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
              </CardContent>
              <CardFooter className="flex-col gap-2">
                <Button
                  onClick={() =>
                    pending &&
                    void finishLogin({ ...pending, totp_code: totpCode.trim() })
                  }
                  disabled={totpCode.length < 6}
                  className="w-full"
                >
                  Verify
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setNeedsTotp(false)
                    setTotpCode("")
                    setPending(null)
                  }}
                  className="w-full"
                >
                  Cancel
                </Button>
              </CardFooter>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
