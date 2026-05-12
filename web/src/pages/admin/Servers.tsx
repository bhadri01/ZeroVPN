import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconKey, IconRouter } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { EmptyState } from "@/components/EmptyState"
import { PageStagger, StaggerItem } from "@/components/motion"
import { PageHead, Panel } from "@/components/swiss"
import { StatusPill } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  adminListServers,
  adminPatchServer,
  adminRotateServerKeys,
} from "@/lib/api"
import type { AdminServerRow } from "@/lib/api"

export function ServersPage() {
  const q = useQuery({
    queryKey: ["admin", "servers"],
    queryFn: adminListServers,
  })

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · 06"
          title="Servers"
          sub="hubs · keypairs · rotation · drain"
        />
      </StaggerItem>
      {q.isLoading && (
        <StaggerItem className="flex flex-col gap-3">
          <Skeleton className="h-48 rounded-none" />
          <Skeleton className="h-48 rounded-none" />
        </StaggerItem>
      )}
      {q.data && q.data.length === 0 && (
        <StaggerItem>
          <EmptyState
            icon={IconRouter}
            title="No servers configured"
            description="Bootstrap creates a default server on first boot."
          />
        </StaggerItem>
      )}
      {q.data?.map((s) => (
        <StaggerItem key={s.id}>
          <ServerEditor server={s} />
        </StaggerItem>
      ))}
    </PageStagger>
  )
}

function ServerEditor({ server }: { server: AdminServerRow }) {
  const qc = useQueryClient()
  const [endpointHost, setEndpointHost] = useState(server.endpoint_host)
  const [endpointPort, setEndpointPort] = useState(String(server.endpoint_port))
  const [mtu, setMtu] = useState(String(server.mtu))
  const [dnsServers, setDnsServers] = useState(server.dns_servers.join(", "))
  const [rotateOpen, setRotateOpen] = useState(false)

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
      setRotateOpen(false)
      qc.invalidateQueries({ queryKey: ["admin", "servers"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <IconRouter className="size-4" />
          {server.name}
        </span>
      }
      sub={`${server.region} · ${server.cidr}`}
      right={<StatusPill status={server.is_active ? "active" : "offline"} />}
      footer={
        <div className="flex w-full justify-between">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setRotateOpen(true)}
            disabled={rotate.isPending}
          >
            <IconKey />
            {rotate.isPending ? "Rotating…" : "Rotate keys"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label className="zv-eyebrow">Public key</Label>
        <CopyableCode value={server.public_key} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`eh-${server.id}`} className="zv-eyebrow">
            Endpoint host
          </Label>
          <Input
            id={`eh-${server.id}`}
            value={endpointHost}
            onChange={(e) => setEndpointHost(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ep-${server.id}`} className="zv-eyebrow">
            Endpoint port
          </Label>
          <Input
            id={`ep-${server.id}`}
            type="number"
            value={endpointPort}
            onChange={(e) => setEndpointPort(e.target.value)}
            className="font-mono"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor={`mtu-${server.id}`} className="zv-eyebrow">
          MTU
        </Label>
        <Input
          id={`mtu-${server.id}`}
          type="number"
          value={mtu}
          onChange={(e) => setMtu(e.target.value)}
          className="font-mono"
        />
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor={`dns-${server.id}`} className="zv-eyebrow">
          DNS servers (comma-separated IPs)
        </Label>
        <Input
          id={`dns-${server.id}`}
          value={dnsServers}
          onChange={(e) => setDnsServers(e.target.value)}
          placeholder="10.10.0.1, 1.1.1.1"
          className="font-mono"
        />
      </div>
      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title="Rotate server keys?"
        description={`Generates a new keypair, rewrites wg0.conf on the shared volume, and persists the new pubkey. All peer .conf files must be re-downloaded; the wg container needs a restart.`}
        confirmText={server.name}
        confirmLabel="Rotate keys"
        destructive
        pending={rotate.isPending}
        onConfirm={() => rotate.mutate()}
      />
    </Panel>
  )
}
