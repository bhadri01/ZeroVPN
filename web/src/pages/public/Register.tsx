import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { ApiError, login, register as registerApi } from "@/lib/api"
import { useAuth } from "@/stores/auth"

const schema = z
  .object({
    email: z.string().email("invalid email"),
    password: z.string().min(12, "min 12 chars").max(128),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "passwords do not match",
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
      // Phase 1A auto-activates new accounts; log them in immediately.
      const res = await login({ email: values.email, password: values.password })
      setUser(res.user)
      toast.success("Account created")
      navigate(res.user.role === "admin" ? "/admin" : "/app")
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
      else toast.error("Registration failed")
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Create account</h1>

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
            autoComplete="new-password"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-destructive text-xs">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="confirm" className="text-sm font-medium">Confirm password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            {...register("confirm")}
          />
          {errors.confirm && (
            <p className="text-destructive text-xs">{errors.confirm.message}</p>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Creating…" : "Create account"}
        </Button>

        <div className="text-muted-foreground text-center text-sm">
          Already have an account? <Link to="/login" className="underline">Sign in</Link>
        </div>
      </form>
    </div>
  )
}
