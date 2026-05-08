import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  ApiError,
  type ApiTokenScope,
  type CreatedApiToken,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/lib/api"

export function ApiTokensPage() {
  const qc = useQueryClient()
  const tokensQ = useQuery({ queryKey: ["api-tokens"], queryFn: listApiTokens })
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [name, setName] = useState("")
  const [scope, setScope] = useState<ApiTokenScope>("read")

  const createM = useMutation({
    mutationFn: () => createApiToken({ name: name.trim(), scope }),
    onSuccess: (d) => {
      setCreated(d)
      setName("")
      void qc.invalidateQueries({ queryKey: ["api-tokens"] })
      toast.success("Token created")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const revokeM = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["api-tokens"] })
      toast.warning("Token revoked")
    },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API tokens</h1>
        <p className="text-muted-foreground text-sm">
          Programmatic access to your ZeroVPN account. Tokens are shown once
          on creation and hashed at rest.
        </p>
      </div>
        <section className="space-y-2">
          <p className="text-muted-foreground text-sm">
            API tokens let scripts and CLIs call ZeroVPN endpoints without
            interactive sign-in. Scope <code>read</code> is enough for stat
            queries; <code>read_write</code> for device CRUD.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Token label (e.g. backup-cron)"
              className="border-input bg-background w-72 rounded-md border px-3 py-2 text-sm"
            />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ApiTokenScope)}
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            >
              <option value="read">read</option>
              <option value="read_write">read_write</option>
              <option value="admin">admin</option>
            </select>
            <Button
              onClick={() => createM.mutate()}
              disabled={createM.isPending || name.trim().length === 0}
            >
              {createM.isPending ? "Creating…" : "Create token"}
            </Button>
          </div>

          {created && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2 rounded-lg border p-4"
            >
              <p className="text-sm font-medium">
                Save this token — it appears only once.
              </p>
              <code className="bg-muted block break-all rounded p-2 font-mono text-xs">
                {created.plaintext_token}
              </code>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(created.plaintext_token)
                    toast.success("Token copied")
                  }}
                >
                  Copy
                </Button>
                <Button size="sm" onClick={() => setCreated(null)}>
                  I've saved it
                </Button>
              </div>
            </motion.div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Active tokens</h2>
          {tokensQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
          {tokensQ.data?.length === 0 && (
            <p className="text-muted-foreground text-sm">No tokens yet.</p>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase">
                <tr>
                  <th className="p-2">Name</th>
                  <th className="p-2">Scope</th>
                  <th className="p-2">Last used</th>
                  <th className="p-2">Created</th>
                  <th className="p-2">Status</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {tokensQ.data?.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2 font-medium">{t.name}</td>
                    <td className="p-2">{t.scope}</td>
                    <td className="p-2 text-xs">
                      {t.last_used_at
                        ? new Date(t.last_used_at).toLocaleString()
                        : "Never"}
                    </td>
                    <td className="p-2 text-xs">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-2 text-xs">
                      {t.revoked_at ? (
                        <span className="text-muted-foreground">revoked</span>
                      ) : (
                        <span className="text-green-600 dark:text-green-400">
                          active
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      {!t.revoked_at && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (confirm(`Revoke "${t.name}"?`)) revokeM.mutate(t.id)
                          }}
                          disabled={revokeM.isPending}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
    </div>
  )
}
