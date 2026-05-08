import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  adminListServers,
  adminPatchServer,
  adminRotateServerKeys,
} from "@/lib/api"
import type { AdminServerRow } from "@/lib/api"

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm font-mono"
const labelClass = "text-sm font-medium"

export function ServersPage() {
  const q = useQuery({
    queryKey: ["admin", "servers"],
    queryFn: adminListServers,
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
        <p className="text-muted-foreground text-sm">
          WireGuard servers under management. Edit endpoint, MTU, DNS or
          rotate keys.
        </p>
      </div>
      {q.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {q.data && q.data.length === 0 && (
        <p className="text-muted-foreground text-sm">No servers configured.</p>
      )}
      {q.data?.map((s) => <ServerEditor key={s.id} server={s} />)}
    </div>
  )
}

function ServerEditor({ server }: { server: AdminServerRow }) {
  const qc = useQueryClient()
  const [endpointHost, setEndpointHost] = useState(server.endpoint_host)
  const [endpointPort, setEndpointPort] = useState(String(server.endpoint_port))
  const [mtu, setMtu] = useState(String(server.mtu))
  const [dnsServers, setDnsServers] = useState(server.dns_servers.join(", "))

  const save = useMutation({
    mutationFn: () =>
      adminPatchServer(server.id, {
        endpoint_host: endpointHost.trim() || undefined,
        endpoint_port: Number(endpointPort) || undefined,
        mtu: Number(mtu) || undefined,
        dns_servers: dnsServers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success("Server config saved")
      qc.invalidateQueries({ queryKey: ["admin", "servers"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rotate = useMutation({
    mutationFn: () => adminRotateServerKeys(server.id),
    onSuccess: (data) => {
      toast.success("Server keys rotated", { description: data.warning })
      qc.invalidateQueries({ queryKey: ["admin", "servers"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <section className="rounded-lg border p-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{server.name}</h2>
          <p className="text-muted-foreground text-xs">
            {server.region} · CIDR {server.cidr}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            server.is_active
              ? "bg-green-500/15 text-green-700"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {server.is_active ? "active" : "inactive"}
        </span>
      </header>
      <div className="space-y-3">
        <div className="space-y-1">
          <label htmlFor={`pk-${server.id}`} className={labelClass}>
            Public key
          </label>
          <input
            id={`pk-${server.id}`}
            readOnly
            value={server.public_key}
            className={inputClass + " bg-muted/40"}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor={`eh-${server.id}`} className={labelClass}>
              Endpoint host
            </label>
            <input
              id={`eh-${server.id}`}
              className={inputClass}
              value={endpointHost}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEndpointHost(e.target.value)
              }
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`ep-${server.id}`} className={labelClass}>
              Endpoint port
            </label>
            <input
              id={`ep-${server.id}`}
              type="number"
              className={inputClass}
              value={endpointPort}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEndpointPort(e.target.value)
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor={`mtu-${server.id}`} className={labelClass}>
            MTU
          </label>
          <input
            id={`mtu-${server.id}`}
            type="number"
            className={inputClass}
            value={mtu}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setMtu(e.target.value)
            }
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`dns-${server.id}`} className={labelClass}>
            DNS servers (comma-separated IPs)
          </label>
          <input
            id={`dns-${server.id}`}
            className={inputClass}
            value={dnsServers}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setDnsServers(e.target.value)
            }
            placeholder="10.10.0.1, 1.1.1.1"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="destructive"
            disabled={rotate.isPending}
            onClick={() => {
              if (
                confirm(
                  "Rotate server keys?\n\n" +
                    "All peers must re-download their .conf and the wg " +
                    "container needs a restart afterwards.\n\n" +
                    "This is irreversible.",
                )
              ) {
                rotate.mutate()
              }
            }}
          >
            {rotate.isPending ? "Rotating…" : "Rotate keys"}
          </Button>
        </div>
      </div>
    </section>
  )
}
