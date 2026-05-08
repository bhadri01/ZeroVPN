import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconKey, IconRouter } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { EmptyState } from "@/components/EmptyState"
import { PageHeader } from "@/components/PageHeader"
import { StatusPill } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
    <div className="space-y-6">
      <PageHeader
        title="Servers"
        description="WireGuard servers under management. Edit endpoint, MTU, DNS, or rotate keys."
      />
      {q.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <EmptyState
          icon={IconRouter}
          title="No servers configured"
          description="Bootstrap creates a default server on first boot."
        />
      )}
      <div className="space-y-4">
        {q.data?.map((s) => <ServerEditor key={s.id} server={s} />)}
      </div>
    </div>
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
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconRouter className="size-4" />
            {server.name}
          </CardTitle>
          <CardDescription>
            {server.region} · {server.cidr}
          </CardDescription>
        </div>
        <StatusPill status={server.is_active ? "active" : "offline"} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Public key</Label>
          <CopyableCode value={server.public_key} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`eh-${server.id}`}>Endpoint host</Label>
            <Input
              id={`eh-${server.id}`}
              value={endpointHost}
              onChange={(e) => setEndpointHost(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ep-${server.id}`}>Endpoint port</Label>
            <Input
              id={`ep-${server.id}`}
              type="number"
              value={endpointPort}
              onChange={(e) => setEndpointPort(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`mtu-${server.id}`}>MTU</Label>
          <Input
            id={`mtu-${server.id}`}
            type="number"
            value={mtu}
            onChange={(e) => setMtu(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`dns-${server.id}`}>
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
      </CardContent>
      <CardFooter className="flex justify-between">
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
      </CardFooter>
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
    </Card>
  )
}
