import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import {
  AuthForm,
  AuthFooterRule,
  AuthHeading,
  AuthShell,
} from "@/components/layout/AuthShell"
import { Kbd, Pill } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, register as registerApi, resendVerify } from "@/lib/api"

const schema = z
  .object({
    email: z.string().email("Enter a valid email"),
    password: z.string().min(12, "Use at least 12 characters").max(128),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  })

type FormValues = z.infer<typeof schema>

export function RegisterPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (values: FormValues) => {
    try {
      await registerApi({ email: values.email, password: values.password })
      setSentTo(values.email)
      toast.success("Check your inbox to verify your email")
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
      else toast.error("Registration failed")
    }
  }

  const onResend = async () => {
    if (!sentTo) return
    setResending(true)
    try {
      await resendVerify(sentTo)
      toast.success("Verification email re-sent")
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
      else toast.error("Couldn't resend the email")
    } finally {
      setResending(false)
    }
  }

  if (sentTo) {
    return (
      <AuthShell>
        <AuthForm>
          <AuthHeading eyebrow="02 · Verify email">
            Check your inbox.
          </AuthHeading>

          <div className="flex items-center gap-3">
            <Pill tone="warn">pending</Pill>
            <span className="text-muted-foreground font-mono text-xs">
              link expires in 24h
            </span>
          </div>

          <p className="text-sm leading-relaxed">
            We sent a verification link to{" "}
            <span className="font-mono">{sentTo}</span>. Click the link to
            activate your account — you can sign in after that.
          </p>

          <p className="text-muted-foreground text-xs leading-relaxed">
            Didn't get the email? Check your spam folder, or resend it below.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/login">Go to sign in</Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onResend}
              disabled={resending}
            >
              {resending ? "Resending…" : "Resend email"}
            </Button>
          </div>

          <AuthFooterRule>
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="hover:text-foreground"
            >
              ← Use a different email
            </button>
          </AuthFooterRule>
        </AuthForm>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <AuthForm onSubmit={handleSubmit(onSubmit)}>
        <AuthHeading eyebrow="01 · Create account">
          First user becomes admin.
        </AuthHeading>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email" className="zv-eyebrow">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@your-domain.tld"
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
          <Label htmlFor="password" className="zv-eyebrow">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••••••"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          {errors.password ? (
            <p className="text-destructive font-mono text-xs">
              {errors.password.message}
            </p>
          ) : (
            <p className="text-muted-foreground font-mono text-[11px]">
              At least 12 chars. Argon2-hashed at rest.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm" className="zv-eyebrow">
            Confirm
          </Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••••••"
            aria-invalid={!!errors.confirm}
            {...register("confirm")}
          />
          {errors.confirm && (
            <p className="text-destructive font-mono text-xs">
              {errors.confirm.message}
            </p>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} size="lg">
          {isSubmitting ? "Creating…" : "Create account"}
          <Kbd className="ml-2">↵</Kbd>
        </Button>

        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>Already have an account?</span>
          <Link to="/login" className="text-foreground hover:underline">
            Sign in ↗
          </Link>
        </div>

        <AuthFooterRule>
          <Link to="/login" className="hover:text-foreground">
            ← Back to sign in
          </Link>
        </AuthFooterRule>
      </AuthForm>
    </AuthShell>
  )
}
