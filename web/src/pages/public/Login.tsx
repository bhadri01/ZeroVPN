import { zodResolver } from "@hookform/resolvers/zod"
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
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (values: FormValues) => {
    try {
      const res = await login(values)
      setUser(res.user)
      toast.success(`Welcome, ${res.user.email}`)
      navigate(res.user.role === "admin" ? "/admin" : "/app")
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 429) toast.error("Too many attempts. Try again in a few minutes.")
        else if (e.status === 401) toast.error("Invalid email or password")
        else if (e.status === 403) toast.error("Account suspended or pending verification")
        else toast.error(e.message)
      } else {
        toast.error("Login failed")
      }
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
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
          {errors.password && <p className="text-destructive text-xs">{errors.password.message}</p>}
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>

        <div className="text-muted-foreground text-center text-sm">
          No account? <Link to="/register" className="underline">Create one</Link>
        </div>
      </form>
    </div>
  )
}
