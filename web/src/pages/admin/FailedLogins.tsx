import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { adminListFailedLogins } from "@/lib/api"

export function FailedLoginsPage() {
  const q = useQuery({
    queryKey: ["admin", "failed-logins"],
    queryFn: () => adminListFailedLogins(200, 0),
  })

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">Failed logins</h1>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin">Back</Link>
        </Button>
      </header>
      <main className="mx-auto max-w-3xl p-6">
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
      </main>
    </div>
  )
}
