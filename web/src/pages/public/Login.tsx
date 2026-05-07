import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { ApiError, login } from "@/lib/api"
import { useAuth } from "@/stores/auth"

const schema = z.object({
  email: z.string().email("invalid email"),
  password: z.string().min(1, "password required"),
})
type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const navigate = useNavigate()
  const setUser = useAuth((s) => s.setUser)
  const [needsTotp, setNeedsTotp] = useState(false)
  const [pending, setPending] = useState<{ email: string; password: string } | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const finishLogin = async (creds: { email: string; password: string; totp_code?: string }) => {
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
        if (e.status === 429) toast.error("Too many attempts. Try again in a few minutes.")
        else if (e.status === 401)
          toast.error(needsTotp ? "Invalid 2FA code" : "Invalid email or password")
        else if (e.status === 403) toast.error("Account suspended or pending verification")
        else toast.error(e.message)
      } else {
        toast.error("Login failed")
      }
    }
  }

  const onSubmit = async (values: FormValues) => {
    await finishLogin(values)
  }

  const onTotpSubmit = async () => {
    if (!pending) return
    await finishLogin({ ...pending, totp_code: totpCode.trim() })
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      {!needsTotp ? (
        <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold">Sign in</h1>

          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              {...register("email")}
            />
            {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-destructive text-xs">{errors.password.message}</p>
            )}
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>

          <div className="text-muted-foreground text-center text-sm">
            No account? <Link to="/register" className="underline">Create one</Link>
          </div>
        </form>
      ) : (
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold">Two-factor code</h1>
          <p className="text-muted-foreground text-sm">
            Enter the 6-digit code from your authenticator app, or an 8-character
            recovery code.
          </p>
          <input
            inputMode="numeric"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            autoFocus
            placeholder="123456"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
          />
          <Button onClick={onTotpSubmit} disabled={totpCode.length < 6} className="w-full">
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
        </div>
      )}
    </div>
  )
}
