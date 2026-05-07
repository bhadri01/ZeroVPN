import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { BandwidthChart } from "@/components/charts/BandwidthChart"
import { Button } from "@/components/ui/button"
import { TopologyGraph, applyEmaSmoothing } from "@/components/topology/TopologyGraph"
import { useWebSocket } from "@/hooks/useWebSocket"
import {
  ApiError,
  type BandwidthRange,
  type CreatedDevice,
  type DeviceOs,
  createDevice,
  deleteDevice,
  listDevices,
  logout,
  pauseDevice,
  unpauseDevice,
  userBandwidth,
} from "@/lib/api"
import type { Event } from "@/lib/wire"
import { useAuth } from "@/stores/auth"

export function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const reset = useAuth((s) => s.reset)
  const queryClient = useQueryClient()
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
  const [created, setCreated] = useState<CreatedDevice | null>(null)
  const [name, setName] = useState("")
  const [osChoice, setOsChoice] = useState<DeviceOs>("other")
  const [rates, setRates] = useState<Map<string, { rxBps: number; txBps: number }>>(
    new Map(),
  )
  const [bwRange, setBwRange] = useState<BandwidthRange>("24h")
  const bandwidthQ = useQuery({
    queryKey: ["bandwidth", "user", bwRange],
    queryFn: () => userBandwidth(bwRange),
    staleTime: 60_000,
  })

  const onWsEvent = useCallback((event: Event) => {
    if (event.type === "stats_delta") {
      setRates((prev) =>
        applyEmaSmoothing(prev, {
          deviceId: event.device_id,
          rxBps: event.rate_rx_bps,
          txBps: event.rate_tx_bps,
        }),
      )
    } else if (event.type === "peer_status_changed") {
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
    }
  }, [queryClient])

  const ws = useWebSocket({
    path: "/api/v1/ws",
    onEvent: onWsEvent,
    enabled: !!user,
  })

  const addM = useMutation({
    mutationFn: () => createDevice({ name: name.trim(), os: osChoice }),
    onSuccess: (data) => {
      setCreated(data)
      setName("")
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device added")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  const pauseM = useMutation({
    mutationFn: (id: string) => pauseDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
      toast.info("Device paused")
    },
  })
  const unpauseM = useMutation({
    mutationFn: (id: string) => unpauseDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device active")
    },
  })
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
      setRates((r) => {
        const updated = new Map(r)
        return updated
      })
      toast.warning("Device revoked")
    },
  })

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">ZeroVPN</h1>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">{user?.email}</span>
          <ConnectionPill state={ws.state} />
          {user?.role === "admin" && (
            <Button asChild variant="outline" size="sm">
              <Link to="/admin">Admin</Link>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await logout()
              reset()
              navigate("/")
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 p-6">
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Live network</h2>
            <p className="text-muted-foreground text-xs">
              Particles flow in the direction of traffic; speed scales with rate.
            </p>
          </div>
          <TopologyGraph devices={devicesQ.data ?? []} rates={rates} />
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Bandwidth</h2>
            <div className="flex gap-1">
              {(["24h", "7d", "30d"] as BandwidthRange[]).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={r === bwRange ? "default" : "outline"}
                  onClick={() => setBwRange(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>
          <BandwidthChart buckets={bandwidthQ.data?.buckets ?? []} />
        </section>

        <section>
          <p className="text-muted-foreground text-xs">
            <Link to="/app/security" className="underline">
              Security & 2FA →
            </Link>
            {" · "}
            <Link to="/app/account" className="underline">
              Account & data →
            </Link>
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Add a device</h2>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Device name (e.g. Pixel 8)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-input bg-background w-64 rounded-md border px-3 py-2 text-sm"
            />
            <select
              value={osChoice}
              onChange={(e) => setOsChoice(e.target.value as DeviceOs)}
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            >
              {(["ios", "android", "macos", "windows", "linux", "other"] as DeviceOs[]).map(
                (o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ),
              )}
            </select>
            <Button
              onClick={() => addM.mutate()}
              disabled={addM.isPending || name.trim().length === 0}
            >
              {addM.isPending ? "Adding…" : "Add device"}
            </Button>
          </div>

          <AnimatePresence>
            {created && (
              <motion.div
                key={created.device.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-3 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-start gap-4">
                  <div
                    className="bg-white p-2"
                    dangerouslySetInnerHTML={{ __html: created.qr_svg }}
                  />
                  <div className="flex-1 space-y-2 text-sm">
                    <p>
                      <strong>{created.device.name}</strong> ·{" "}
                      {created.device.allocated_ip}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Save this config now — the private key is never stored on the server.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const blob = new Blob([created.config], { type: "text/plain" })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement("a")
                          a.href = url
                          a.download = `${created.device.name}.conf`
                          a.click()
                          URL.revokeObjectURL(url)
                        }}
                      >
                        Download .conf
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard.writeText(created.config)
                          toast.success("Config copied")
                        }}
                      >
                        Copy
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                        Done
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Devices</h2>
          {devicesQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
          {devicesQ.isError && (
            <p className="text-destructive">Failed to load devices.</p>
          )}
          {devicesQ.data?.length === 0 && (
            <p className="text-muted-foreground text-sm">No devices yet.</p>
          )}
          <ul className="space-y-2">
            <AnimatePresence>
              {devicesQ.data?.map((d) => {
                const live = rates.get(d.id) ?? { rxBps: 0, txBps: 0 }
                return (
                  <motion.li
                    key={d.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -16 }}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{d.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {d.os} · {d.allocated_ip} · {d.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground text-xs tabular-nums">
                        ↑ {formatBps(live.txBps)} · ↓ {formatBps(live.rxBps)}
                      </span>
                      {d.status === "active" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => pauseM.mutate(d.id)}
                          disabled={pauseM.isPending}
                        >
                          Pause
                        </Button>
                      ) : d.status === "paused" ? (
                        <Button
                          size="sm"
                          onClick={() => unpauseM.mutate(d.id)}
                          disabled={unpauseM.isPending}
                        >
                          Unpause
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Revoke ${d.name}?`)) deleteM.mutate(d.id)
                        }}
                        disabled={deleteM.isPending}
                      >
                        Revoke
                      </Button>
                    </div>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        </section>
      </main>
    </div>
  )
}

function ConnectionPill({ state }: { state: "connecting" | "open" | "closed" }) {
  const colour =
    state === "open"
      ? "bg-green-500/15 text-green-700 dark:text-green-400"
      : state === "connecting"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-red-500/15 text-red-700 dark:text-red-400"
  const label = state === "open" ? "Live" : state === "connecting" ? "Connecting…" : "Offline"
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colour}`}>{label}</span>
  )
}

function formatBps(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}
