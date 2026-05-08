import { useQuery } from "@tanstack/react-query"

import { adminListFailedLogins } from "@/lib/api"

export function FailedLoginsPage() {
  const q = useQuery({
    queryKey: ["admin", "failed-logins"],
    queryFn: () => adminListFailedLogins(200, 0),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Failed logins</h1>
        <p className="text-muted-foreground text-sm">
          Login attempts that didn't succeed in the last 30 days. IPs stored as
          /24 prefixes only.
        </p>
      </div>
      {q.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {q.data && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Email</th>
                <th className="p-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">
                    {new Date(row.attempted_at).toLocaleString()}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {row.email_attempted ?? "—"}
                  </td>
                  <td className="p-2">{row.reason.replace(/_/g, " ")}</td>
                </tr>
              ))}
              {q.data.items.length === 0 && (
                <tr>
                  <td className="text-muted-foreground p-3" colSpan={3}>
                    No failed-login attempts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
