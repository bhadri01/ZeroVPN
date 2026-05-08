import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  ALL_WEBHOOK_EVENTS,
  adminCreateWebhook,
  adminDeleteWebhook,
  adminListWebhooks,
} from "@/lib/api"
import type { WebhookEventKind } from "@/lib/api"

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
const labelClass = "text-sm font-medium"

export function WebhooksPage() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ["admin", "webhooks"],
    queryFn: adminListWebhooks,
  })

  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [secret, setSecret] = useState("")
  const [events, setEvents] = useState<Set<WebhookEventKind>>(
    new Set(ALL_WEBHOOK_EVENTS),
  )

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
      qc.invalidateQueries({ queryKey: ["admin", "webhooks"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => adminDeleteWebhook(id),
    onSuccess: () => {
      toast.success("Webhook deleted")
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

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-muted-foreground text-sm">
          Outbound HTTP notifications when peers, devices, or quotas change
          state.
        </p>
      </div>
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-semibold">Add webhook</h2>
          <form
            className="space-y-3"
            onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
              e.preventDefault()
              if (!name.trim() || !url.trim() || events.size === 0) {
                toast.error("Name, URL, and at least one event are required")
                return
              }
              create.mutate()
            }}
          >
            <div className="space-y-1">
              <label htmlFor="wh-name" className={labelClass}>
                Name
              </label>
              <input
                id="wh-name"
                className={inputClass}
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setName(e.target.value)
                }
                placeholder="My alerter"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="wh-url" className={labelClass}>
                URL
              </label>
              <input
                id="wh-url"
                className={inputClass}
                value={url}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setUrl(e.target.value)
                }
                placeholder="https://example.com/hook"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="wh-secret" className={labelClass}>
                Secret (optional)
              </label>
              <input
                id="wh-secret"
                className={inputClass}
                value={secret}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSecret(e.target.value)
                }
                placeholder="signing secret"
              />
            </div>
            <div className="space-y-1">
              <span className={labelClass}>Events</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {ALL_WEBHOOK_EVENTS.map((ev) => {
                  const checked = events.has(ev)
                  return (
                    <button
                      key={ev}
                      type="button"
                      onClick={() => toggleEvent(ev)}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        checked
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {ev.replace(/_/g, " ")}
                    </button>
                  )
                })}
              </div>
            </div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save webhook"}
            </Button>
          </form>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold">Configured webhooks</h2>
          {q.isLoading && <p className="text-muted-foreground">Loading…</p>}
          {q.data && q.data.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No webhooks configured.
            </p>
          )}
          {q.data && q.data.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase">
                  <tr>
                    <th className="p-2">Name</th>
                    <th className="p-2">URL</th>
                    <th className="p-2">Events</th>
                    <th className="p-2">Last delivery</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.map((w) => (
                    <tr key={w.id} className="border-t">
                      <td className="p-2 font-medium">{w.name}</td>
                      <td className="p-2 font-mono text-xs">{w.url}</td>
                      <td className="p-2 text-xs">
                        {w.events.map((e) => e.replace(/_/g, " ")).join(", ")}
                      </td>
                      <td className="p-2 whitespace-nowrap text-xs">
                        {w.last_delivery_at
                          ? `${new Date(w.last_delivery_at).toLocaleString()} (${
                              w.last_status ?? "?"
                            })`
                          : "—"}
                      </td>
                      <td className="p-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (confirm(`Delete webhook "${w.name}"?`))
                              remove.mutate(w.id)
                          }}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
    </div>
  )
}
