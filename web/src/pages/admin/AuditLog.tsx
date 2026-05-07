import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { adminListAudit } from "@/lib/api"

export function AuditLogPage() {
  const auditQ = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => adminListAudit(200, 0),
  })

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">Audit log</h1>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin">Back</Link>
        </Button>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        {auditQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
        {auditQ.data && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase">
                <tr>
                  <th className="p-2">When</th>
                  <th className="p-2">Actor</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Target</th>
                  <th className="p-2">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {auditQ.data.items.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td className="p-2 text-xs whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="p-2 font-mono text-xs">
                      {row.actor_user_id ? row.actor_user_id.slice(0, 8) : "—"}
                    </td>
                    <td className="p-2">{row.action}</td>
                    <td className="p-2 text-xs">
                      {row.target_type ?? "—"}
                      {row.target_id ? (
                        <span className="text-muted-foreground ml-1 font-mono">
                          {String(row.target_id).slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-2 text-xs">
                      <code className="bg-muted rounded px-1">
                        {JSON.stringify(row.metadata)}
                      </code>
                    </td>
                  </tr>
                ))}
                {auditQ.data.items.length === 0 && (
                  <tr>
                    <td className="text-muted-foreground p-3" colSpan={5}>
                      No audit entries yet.
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
