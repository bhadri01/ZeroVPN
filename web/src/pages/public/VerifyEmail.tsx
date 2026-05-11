import { IconLoader2 } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"

import {
  AuthForm,
  AuthFooterRule,
  AuthHeading,
  AuthShell,
} from "@/components/layout/AuthShell"
import { CodeBlock, Pill } from "@/components/swiss"
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
          setMessage(e instanceof ApiError ? e.message : "Verification failed")
        }
      })
    return () => {
      alive = false
    }
  }, [token])

  return (
    <AuthShell>
      <AuthForm>
        <AuthHeading eyebrow="02 · Verify email">
          {status === "pending"
            ? "Verifying…"
            : status === "ok"
              ? "Check passed."
              : "Verification failed."}
        </AuthHeading>

        <div className="flex items-center gap-3">
          <Pill
            tone={
              status === "ok" ? "ok" : status === "fail" ? "err" : "warn"
            }
          >
            {status === "ok"
              ? "verified"
              : status === "fail"
                ? "failed"
                : "pending"}
          </Pill>
          {status === "pending" && (
            <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {!token ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            We sent a token-link to your inbox. Click it to finish creating
            your account.
          </p>
        ) : (
          <p className="text-sm leading-relaxed">{message}</p>
        )}

        {!token && (
          <CodeBlock>{`From: ZeroVPN <noreply@your-domain.tld>
Subject: Verify your account

→ https://your-host.tld/verify-email?token=eyJhbGciOi…  (24h)`}</CodeBlock>
        )}

        <div className="flex gap-2">
          <Button asChild>
            <Link to="/login">Continue to sign in</Link>
          </Button>
          {status === "fail" && (
            <Button asChild variant="ghost">
              <Link to="/register">Try again</Link>
            </Button>
          )}
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
