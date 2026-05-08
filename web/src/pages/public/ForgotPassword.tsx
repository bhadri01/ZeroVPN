import { IconMail } from "@tabler/icons-react"
import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, forgotPassword } from "@/lib/api"

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await forgotPassword(email.trim())
      setDone(true)
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <span className="bg-primary/10 text-primary mx-auto mb-3 flex size-9 items-center justify-center rounded-md">
            <IconMail className="size-4" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            Forgot password
          </h1>
          <p className="text-muted-foreground text-sm">
            We'll email a reset link. Expires in 1 hour.
          </p>
        </div>
        <Card>
          {done ? (
            <>
              <CardHeader>
                <CardTitle className="text-base">Check your inbox</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                If an account with that email exists, we've emailed a reset
                link. In dev, check MailHog at{" "}
                <code className="bg-muted rounded px-1">:8025</code>.
              </CardContent>
              <CardFooter>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/login">Back to sign in</Link>
                </Button>
              </CardFooter>
            </>
          ) : (
            <form onSubmit={onSubmit} className="contents">
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-3">
                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full"
                >
                  {submitting ? "Sending…" : "Send reset link"}
                </Button>
                <Link
                  to="/login"
                  className="text-muted-foreground hover:text-foreground text-center text-xs"
                >
                  Back to sign in
                </Link>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
