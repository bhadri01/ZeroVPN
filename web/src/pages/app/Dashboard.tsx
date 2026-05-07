import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  ApiError,
  type CreatedDevice,
  type DeviceOs,
  createDevice,
  deleteDevice,
  listDevices,
  logout,
  pauseDevice,
  unpauseDevice,
} from "@/lib/api"
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
      toast.warning("Device revoked")
    },
  })

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">ZeroVPN</h1>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">{user?.email}</span>
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
                      <strong>{created.device.name}</strong> · {created.device.allocated_ip}
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
              {devicesQ.data?.map((d) => (
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
                  <div className="flex gap-2">
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
              ))}
            </AnimatePresence>
          </ul>
        </section>
      </main>
    </div>
  )
}
