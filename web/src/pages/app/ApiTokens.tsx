import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconKey, IconPlus, IconTrash } from "@tabler/icons-react"
import { motion } from "motion/react"
import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { EmptyState } from "@/components/EmptyState"
import { PageHeader } from "@/components/PageHeader"
import { RelativeTime } from "@/components/RelativeTime"
import { StatusPill } from "@/components/StatusPill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
    <div className="space-y-6">
      <PageHeader
        title="API tokens"
        description="Programmatic access — shown once at creation, hashed at rest."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconPlus />
                Create token
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create API token</DialogTitle>
                <DialogDescription>
                  Use <code className="bg-muted px-1 rounded text-xs">read</code>{" "}
                  for stats,{" "}
                  <code className="bg-muted px-1 rounded text-xs">read_write</code>{" "}
                  for device CRUD,{" "}
                  <code className="bg-muted px-1 rounded text-xs">admin</code>{" "}
                  for admin endpoints.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="token-name">Label</Label>
                  <Input
                    id="token-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="backup-cron"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Scope</Label>
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
          <Card className="border-status-online/30 bg-status-online/5">
            <CardHeader>
              <CardTitle className="text-base">
                {created.token.name} · save this token now
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <CopyableCode value={created.plaintext_token} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setCreated(null)}>
                  I've saved it
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tokens</CardTitle>
        </CardHeader>
        <CardContent className="-mx-2 -mb-2">
          {tokensQ.isLoading && (
            <p className="text-muted-foreground p-2 text-sm">Loading…</p>
          )}
          {!tokensQ.isLoading && tokens.length === 0 && (
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
          )}
          {tokens.length > 0 && (
            <ul className="divide-border divide-y">
              {tokens.map((t) => (
                <li
                  key={t.id}
                  className="hover:bg-muted/30 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors"
                >
                  <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
                    <IconKey className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="text-muted-foreground flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {t.scope}
                      </Badge>
                      <span className="hidden sm:inline">
                        Last used{" "}
                        <RelativeTime
                          value={t.last_used_at}
                          fallback="never"
                        />
                      </span>
                    </p>
                  </div>
                  <StatusPill
                    status={t.revoked_at ? "revoked" : "active"}
                    className="hidden sm:inline-flex"
                  />
                  {!t.revoked_at && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setRevokeId(t.id)}
                      disabled={revokeM.isPending}
                      title="Revoke"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <IconTrash className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
