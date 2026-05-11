import type { ReactNode } from "react"

import { Eyebrow, LiveDot, Wordmark } from "@/components/swiss"

/**
 * Two-column public auth chrome. Left side: brand + marketing copy + a
 * status strip; collapses on mobile. Right side: the form (caller's
 * `children`). Matches auth.jsx in the design bundle. Pages compose
 * `<AuthShell><AuthFormCard>…</AuthFormCard></AuthShell>` so the form
 * itself can vary while the surrounding chrome stays consistent.
 */
export function AuthShell({
  left,
  children,
}: {
  /** Override the default left-side promo block. Optional. */
  left?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid min-h-svh grid-cols-1 md:grid-cols-2">
      <aside className="zv-grid-bg bg-muted/40 relative hidden flex-col justify-between gap-12 overflow-hidden border-r p-8 md:flex">
        <div className="flex items-center gap-2">
          <Wordmark size={14} />
        </div>
        {left || <DefaultPromo />}
        <div className="text-muted-foreground flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <span>v1.0.20240310</span>
          <span>·</span>
          <span>region · self-hosted</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1.5">
            <LiveDot />
            api ok
          </span>
        </div>
      </aside>
      <div className="flex items-center justify-center p-8">{children}</div>
    </div>
  )
}

function DefaultPromo() {
  return (
    <div className="flex max-w-[380px] flex-col gap-6">
      <Eyebrow num="—">Self-hosted · No-logs</Eyebrow>
      <h2 className="font-heading m-0 text-3xl font-medium leading-[1.05] tracking-[-0.01em]">
        A VPN console you
        <br />
        actually trust —
        <br />
        because you run it.
      </h2>
      <p className="text-muted-foreground m-0 text-sm leading-relaxed">
        Every operation, every login, every byte counted is on your machine.
        Argon2 hashes, KEK-encrypted secrets, no third-party in the path.
      </p>
    </div>
  )
}

/** The form container used by every auth page. 360px wide, gap-5 stack. */
export function AuthForm({
  children,
  onSubmit,
}: {
  children: ReactNode
  onSubmit?: React.FormEventHandler<HTMLFormElement>
}) {
  return (
    <form className="flex w-[360px] max-w-full flex-col gap-5" onSubmit={onSubmit}>
      {children}
    </form>
  )
}

/** The headline block at the top of each auth page (eyebrow + h1). */
export function AuthHeading({
  eyebrow,
  children,
}: {
  eyebrow: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="font-heading m-0 text-[28px] font-medium tracking-[-0.01em]">
        {children}
      </h1>
    </div>
  )
}

/** Mono uppercase footer rule + tiny copy. Sits below every auth form. */
export function AuthFooterRule({
  children,
}: {
  children?: ReactNode
}) {
  return (
    <>
      <div className="zv-hrule mt-6" />
      <div className="text-muted-foreground flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.06em]">
        <span>secured · argon2 · totp</span>
        {children}
      </div>
    </>
  )
}
