import { zodResolver } from "@hookform/resolvers/zod"
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
import { Label } from "@/components/ui/label"
import { ApiError, login, register as registerApi } from "@/lib/api"
import { useAuth } from "@/stores/auth"

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
  const navigate = useNavigate()
  const setUser = useAuth((s) => s.setUser)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (values: FormValues) => {
    try {
      await registerApi({ email: values.email, password: values.password })
      const res = await login({
        email: values.email,
        password: values.password,
      })
      setUser(res.user)
      toast.success("Account created")
      navigate("/app")
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
      else toast.error("Registration failed")
    }
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
          <Link to="/" className="hover:text-foreground">
            ← Home
          </Link>
        </AuthFooterRule>
      </AuthForm>
    </AuthShell>
  )
}
