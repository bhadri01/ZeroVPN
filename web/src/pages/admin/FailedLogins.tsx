import { useQuery } from "@tanstack/react-query"

import { PageStagger, StaggerItem } from "@/components/motion"
import { RelativeTime } from "@/components/RelativeTime"
import { Kpi, KpiStrip, PageHead, Panel, Pill } from "@/components/swiss"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListFailedLogins } from "@/lib/api"

export function FailedLoginsPage() {
  const q = useQuery({
    queryKey: ["admin", "failed-logins"],
    queryFn: () => adminListFailedLogins(200, 0),
  })

  const items = q.data?.items ?? []
  const total = items.length
  const rateLimited = items.filter((i) => i.reason === "rate_limited").length
  const totpBad = items.filter((i) => i.reason === "totp_incorrect").length
  const noUser = items.filter((i) => i.reason === "no_such_user").length

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 04"
          title="Failed logins"
          sub="brute-force mitigation · rate-limit at 10/min/IP · /24 prefixes only"
        />
      </StaggerItem>

      <StaggerItem>
      <KpiStrip>
        <Kpi
          label="Failed · 30d"
          value={total}
          footL="across all addresses"
          deltaTone={total > 0 ? "dn" : undefined}
        />
        <Kpi
          label="Rate-limited"
          value={rateLimited}
          footL="auto-expire 1h"
        />
        <Kpi label="TOTP wrong" value={totpBad} footL="invalid 2FA code" />
        <Kpi label="No-such-user" value={noUser} footL="email not in DB" />
      </KpiStrip>
      </StaggerItem>

      <StaggerItem>
      <Panel title="Recent failures" sub="last 200 attempts" flush>
        {q.isLoading && (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-8 rounded-none" />
            <Skeleton className="h-8 rounded-none" />
          </div>
        )}
        {q.data && (
          <table className="zv-table">
            <thead>
              <tr>
                <th className="w-[180px]">When</th>
                <th>Email</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="text-muted-foreground font-mono text-xs">
                    <RelativeTime value={row.attempted_at} />
                  </td>
                  <td className="font-mono text-xs">
                    {row.email_attempted ?? (
                      <span className="text-muted-foreground">(no user)</span>
                    )}
                  </td>
                  <td>
                    {reasonPill(row.reason)}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="text-muted-foreground py-8 text-center font-mono text-sm"
                  >
                    No failed-login attempts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Panel>
      </StaggerItem>
    </PageStagger>
  )
}

function reasonPill(reason: string) {
  if (reason === "rate_limited")
    return (
      <Pill tone="err" dot={false}>
        rate-limited
      </Pill>
    )
  if (reason === "totp_incorrect")
    return (
      <Pill tone="warn" dot={false}>
        totp
      </Pill>
    )
  if (reason === "no_such_user")
    return (
      <Pill tone="info" dot={false}>
        no-user
      </Pill>
    )
  return (
    <Pill tone="warn" dot={false}>
      {reason.replace(/_/g, "-")}
    </Pill>
  )
}
