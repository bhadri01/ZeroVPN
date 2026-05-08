import { zodResolver } from "@hookform/resolvers/zod"
import { IconShield } from "@tabler/icons-react"
import { useForm } from "react-hook-form"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
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
      navigate(res.user.role === "admin" ? "/admin" : "/app")
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
      else toast.error("Registration failed")
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
            Create your account
          </h1>
          <p className="text-muted-foreground text-sm">
            Free, self-hosted, no logs.
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit(onSubmit)} className="contents">
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
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!errors.password}
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-destructive text-xs">
                    {errors.password.message}
                  </p>
                )}
                {!errors.password && (
                  <p className="text-muted-foreground text-xs">
                    At least 12 characters.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!errors.confirm}
                  {...register("confirm")}
                />
                {errors.confirm && (
                  <p className="text-destructive text-xs">
                    {errors.confirm.message}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-3">
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Creating…" : "Create account"}
              </Button>
              <p className="text-muted-foreground text-center text-xs">
                Have an account?{" "}
                <Link
                  to="/login"
                  className="text-foreground font-medium hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
