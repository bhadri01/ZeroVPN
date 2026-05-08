import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconPlus, IconTrash, IconWebhook } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { EmptyState } from "@/components/EmptyState"
import { PageHeader } from "@/components/PageHeader"
import { RelativeTime } from "@/components/RelativeTime"
import { StatusPill } from "@/components/StatusPill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Outbound HTTP notifications when peers, devices, or quotas change state."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconPlus />
                Add webhook
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add webhook</DialogTitle>
                <DialogDescription>
                  POST'd as JSON. Optional secret is hashed at rest and used
                  to sign deliveries (header <code>X-ZeroVPN-Signature</code>).
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
                <div className="space-y-1.5">
                  <Label htmlFor="wh-name">Name</Label>
                  <Input
                    id="wh-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My alerter"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wh-url">URL</Label>
                  <Input
                    id="wh-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/hook"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wh-secret">Secret (optional)</Label>
                  <Input
                    id="wh-secret"
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="signing secret"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Events</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_WEBHOOK_EVENTS.map((ev) => {
                      const checked = events.has(ev)
                      return (
                        <button
                          key={ev}
                          type="button"
                          onClick={() => toggleEvent(ev)}
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                            checked
                              ? "bg-primary/10 text-primary border-primary/30"
                              : "border-border text-muted-foreground hover:bg-muted/50"
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

      <Card>
        <CardContent>
          {q.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          )}
          {!q.isLoading && items.length === 0 && (
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
          )}
          {items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Last delivery</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="font-mono text-xs">{w.url}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {w.events.map((e) => (
                          <Badge
                            key={e}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {e.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {w.last_delivery_at ? (
                        <span className="flex items-center gap-1.5">
                          <RelativeTime value={w.last_delivery_at} />
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            {w.last_status ?? "?"}
                          </Badge>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusPill
                        status={w.active ? "active" : "paused"}
                        label={w.active ? "active" : "off"}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setDeleteId(w.id)}
                        title="Delete"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <IconTrash className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
