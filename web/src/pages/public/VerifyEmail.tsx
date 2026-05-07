import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"

import { Button } from "@/components/ui/button"
import { ApiError, verifyEmail } from "@/lib/api"

type Status = "pending" | "ok" | "fail"

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get("token")
  const [status, setStatus] = useState<Status>("pending")
  const [message, setMessage] = useState<string>("")

  useEffect(() => {
    if (!token) {
      setStatus("fail")
      setMessage("Missing verification token.")
      return
    }
    let alive = true
    verifyEmail(token)
      .then(() => {
        if (alive) {
          setStatus("ok")
          setMessage("Your email is verified. You can sign in now.")
        }
      })
      .catch((e) => {
        if (alive) {
          setStatus("fail")
          setMessage(
            e instanceof ApiError ? e.message : "Verification failed",
          )
        }
      })
    return () => {
      alive = false
    }
  }, [token])

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Email verification</h1>
        {status === "pending" && (
          <p className="text-muted-foreground text-sm">Verifying…</p>
        )}
        {status !== "pending" && (
          <p
            className={
              status === "ok" ? "text-green-600 text-sm" : "text-destructive text-sm"
            }
          >
            {message}
          </p>
        )}
        <Button asChild>
          <Link to="/login">Continue to sign in</Link>
        </Button>
      </div>
    </div>
  )
}
