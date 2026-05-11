import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconKey, IconPlus } from "@tabler/icons-react"
import { motion } from "motion/react"
import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { EmptyState } from "@/components/EmptyState"
import { RelativeTime } from "@/components/RelativeTime"
import {
  Banner,
  Kbd,
  PageHead,
  Panel,
  Pill,
} from "@/components/swiss"
import { StatusPill } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [scope, setScope] = useState<ApiTokenScope>("read")
  const [revokeId, setRevokeId] = useState<string | null>(null)

  const createM = useMutation({
    mutationFn: () => createApiToken({ name: name.trim(), scope }),
    onSuccess: (d) => {
      setCreated(d)
      setName("")
      setCreateOpen(false)
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
      setRevokeId(null)
      void qc.invalidateQueries({ queryKey: ["api-tokens"] })
      toast.warning("Token revoked")
    },
  })

  const tokens = tokensQ.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Account · 05"
        title="API tokens"
        sub="OpenAPI · scoped · one-time plaintext reveal"
        right={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconPlus />
                Generate token
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create API token</DialogTitle>
                <DialogDescription>
                  Use <Kbd>read</Kbd> for stats, <Kbd>read_write</Kbd> for
                  device CRUD, <Kbd>admin</Kbd> for admin endpoints.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="token-name" className="zv-eyebrow">
                    Label
                  </Label>
                  <Input
                    id="token-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="backup-cron"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="zv-eyebrow">Scope</Label>
                  <Select
                    value={scope}
                    onValueChange={(v) => setScope(v as ApiTokenScope)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read">read</SelectItem>
                      <SelectItem value="read_write">read_write</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button
                  onClick={() => createM.mutate()}
                  disabled={createM.isPending || name.trim().length === 0}
                >
                  {createM.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {created && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <Banner
            tone="warn"
            tag="REVEAL · ONE TIME"
            right={
              <>
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCreated(null)}
                >
                  Dismiss
                </Button>
              </>
            }
          >
            Copy this token now. After this page reload, you'll never see it
            again.
          </Banner>
          <div className="mt-3">
            <CopyableCode value={created.plaintext_token} />
          </div>
        </motion.div>
      )}

      <Panel flush>
        {tokensQ.isLoading && (
          <p className="text-muted-foreground p-4 font-mono text-sm">Loading…</p>
        )}
        {!tokensQ.isLoading && tokens.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={IconKey}
              title="No tokens yet"
              description="Create a token to authenticate scripts, cron jobs, or CLIs."
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <IconPlus />
                  Create token
                </Button>
              }
            />
          </div>
        )}
        {tokens.length > 0 && (
          <table className="zv-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scope</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="font-medium">{t.name}</span>{" "}
                    <Kbd className="ml-2">{t.id.slice(0, 8)}</Kbd>
                  </td>
                  <td>
                    <Pill tone="info" dot={false}>
                      {t.scope}
                    </Pill>
                  </td>
                  <td className="text-muted-foreground font-mono">
                    {t.created_at?.slice(0, 10) ?? "—"}
                  </td>
                  <td className="text-muted-foreground font-mono">
                    <RelativeTime value={t.last_used_at} fallback="never" />
                  </td>
                  <td>
                    <StatusPill status={t.revoked_at ? "revoked" : "active"} />
                  </td>
                  <td className="zv-actions">
                    {!t.revoked_at && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRevokeId(t.id)}
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
        )}
      </Panel>

      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(o) => !o && setRevokeId(null)}
        title="Revoke token?"
        description="Once revoked, calls using this token will return 401. This is irreversible."
        confirmLabel="Revoke"
        destructive
        pending={revokeM.isPending}
        onConfirm={() => revokeId && revokeM.mutate(revokeId)}
      />
    </div>
  )
}
