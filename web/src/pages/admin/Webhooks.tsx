import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconPlus, IconWebhook } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { EmptyState } from "@/components/EmptyState"
import { RelativeTime } from "@/components/RelativeTime"
import { Kbd, PageHead, Panel } from "@/components/swiss"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  ALL_WEBHOOK_EVENTS,
  adminCreateWebhook,
  adminDeleteWebhook,
  adminListWebhooks,
} from "@/lib/api"
import type { WebhookEventKind } from "@/lib/api"

export function WebhooksPage() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ["admin", "webhooks"],
    queryFn: adminListWebhooks,
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [secret, setSecret] = useState("")
  const [events, setEvents] = useState<Set<WebhookEventKind>>(
    new Set(ALL_WEBHOOK_EVENTS),
  )
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () =>
      adminCreateWebhook({
        name: name.trim(),
        url: url.trim(),
        events: Array.from(events),
        secret: secret.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Webhook created")
      setName("")
      setUrl("")
      setSecret("")
      setCreateOpen(false)
      qc.invalidateQueries({ queryKey: ["admin", "webhooks"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => adminDeleteWebhook(id),
    onSuccess: () => {
      toast.success("Webhook deleted")
      setDeleteId(null)
      qc.invalidateQueries({ queryKey: ["admin", "webhooks"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleEvent = (kind: WebhookEventKind) => {
    setEvents((s) => {
      const next = new Set(s)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const items = q.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Admin · 05"
        title="Webhooks"
        sub="signed deliveries · retries · last-200-bodies kept"
        right={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconPlus />
                New webhook
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add webhook</DialogTitle>
                <DialogDescription>
                  POST'd as JSON. Optional secret is hashed at rest and used
                  to sign deliveries (header{" "}
                  <Kbd>X-ZeroVPN-Signature</Kbd>).
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!name.trim() || !url.trim() || events.size === 0) {
                    toast.error("Name, URL, and ≥1 event are required")
                    return
                  }
                  create.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-name" className="zv-eyebrow">
                    Name
                  </Label>
                  <Input
                    id="wh-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="ops-slack"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-url" className="zv-eyebrow">
                    URL
                  </Label>
                  <Input
                    id="wh-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/…"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-secret" className="zv-eyebrow">
                    Signing secret (optional)
                  </Label>
                  <Input
                    id="wh-secret"
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="HMAC-SHA256 shared secret"
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="zv-eyebrow">Events</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_WEBHOOK_EVENTS.map((ev) => {
                      const checked = events.has(ev)
                      return (
                        <button
                          key={ev}
                          type="button"
                          onClick={() => toggleEvent(ev)}
                          className={`border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors ${
                            checked
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:border-foreground"
                          }`}
                        >
                          {ev.replace(/_/g, " ")}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="ghost">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button type="submit" disabled={create.isPending}>
                    {create.isPending ? "Saving…" : "Save"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <Panel flush>
        {q.isLoading && (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-8 rounded-none" />
            <Skeleton className="h-8 rounded-none" />
          </div>
        )}
        {!q.isLoading && items.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={IconWebhook}
              title="No webhooks configured"
              description="Add a webhook to receive HTTP POSTs on peer or device events."
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <IconPlus />
                  Add webhook
                </Button>
              }
            />
          </div>
        )}
        {items.length > 0 && (
          <table className="zv-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Events</th>
                <th>Last delivery</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id}>
                  <td>
                    <span className="font-medium">{w.name}</span>
                  </td>
                  <td className="text-muted-foreground max-w-[280px] truncate font-mono">
                    {w.url}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {w.events.map((e) => (
                        <Kbd key={e}>{e.replace(/_/g, " ")}</Kbd>
                      ))}
                    </div>
                  </td>
                  <td className="font-mono text-xs">
                    {w.last_delivery_at ? (
                      <span className="flex items-center gap-1.5">
                        <RelativeTime value={w.last_delivery_at} />
                        <Kbd>{w.last_status ?? "?"}</Kbd>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">never</span>
                    )}
                  </td>
                  <td>
                    <StatusPill
                      status={w.active ? "active" : "paused"}
                      label={w.active ? "active" : "off"}
                    />
                  </td>
                  <td className="zv-actions">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteId(w.id)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete webhook?"
        description="Future events won't be delivered. Existing delivery history is preserved on the audit log."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleteId && remove.mutate(deleteId)}
      />
    </div>
  )
}
