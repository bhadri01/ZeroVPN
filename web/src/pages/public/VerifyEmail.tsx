import {
  IconCircleCheck,
  IconCircleX,
  IconLoader2,
  IconMail,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
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

  const Icon =
    status === "ok"
      ? IconCircleCheck
      : status === "fail"
        ? IconCircleX
        : IconLoader2
  const tone =
    status === "ok"
      ? "bg-status-online/10 text-status-online"
      : status === "fail"
        ? "bg-status-revoked/10 text-status-revoked"
        : "bg-primary/10 text-primary"

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <span className="bg-primary/10 text-primary mx-auto mb-3 flex size-9 items-center justify-center rounded-md">
            <IconMail className="size-4" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            Email verification
          </h1>
        </div>
        <Card>
          <CardContent className="space-y-4 text-center">
            <span
              className={`mx-auto flex size-9 items-center justify-center rounded-full ${tone}`}
            >
              <Icon
                className={
                  status === "pending"
                    ? "size-4 animate-spin"
                    : "size-4"
                }
              />
            </span>
            <p className="text-sm">
              {status === "pending" ? "Verifying…" : message}
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild className="w-full">
              <Link to="/login">Continue to sign in</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
