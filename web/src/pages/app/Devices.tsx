import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconDeviceTablet,
  IconDownload,
  IconGripVertical,
  IconLayoutGrid,
  IconLayoutList,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconQrcode,
  IconSearch,
  IconX,
} from "@tabler/icons-react"
import { Link, useNavigate } from "react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { DeviceCard } from "@/components/DeviceCard"
import { EmptyState } from "@/components/EmptyState"
import { FilterDropdown } from "@/components/FilterDropdown"
import { PageStagger, StaggerItem } from "@/components/motion"
import {
  Eyebrow,
  fmtRel,
  IconBtn,
  PageHead,
  Panel,
  Sparkline,
} from "@/components/swiss"
import { StatusPill, type Status as PillStatus } from "@/components/StatusPill"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  ApiError,
  type CreatedDevice,
  type DeviceOs,
  type DnsCheck,
  type PublicDevice,
  checkDnsName,
  createDevice,
  deleteDevice,
  listDevices,
  meServer,
  pauseDevice,
  reorderDevices,
  setDeviceDns,
  unpauseDevice,
} from "@/lib/api"
import {
  connState,
  peerState,
  type ConnState,
  type PeerState,
} from "@/lib/deviceState"
import { useAuth } from "@/stores/auth"
import { useLiveStats } from "@/stores/liveStats"

/** Pill that <StatusPill> uses to render the cell. Connection is the
 *  primary lens — what the user actually cares about — so the row pill
 *  follows that. Revoked overrides because it's terminal. */
function rowPill(c: ConnState, p: PeerState): PillStatus {
  if (p === "revoked") return "revoked"
  if (p === "paused") return "paused"
  return c // online | offline
}

const CONN_FILTERS: { value: ConnState; label: string; pill: PillStatus }[] = [
  { value: "online", label: "Online", pill: "online" },
  { value: "offline", label: "Offline", pill: "offline" },
]

const PEER_FILTERS: { value: PeerState; label: string; pill: PillStatus }[] = [
  { value: "live", label: "Live", pill: "online" },
  { value: "paused", label: "Paused", pill: "paused" },
  { value: "revoked", label: "Revoked", pill: "revoked" },
]

type ViewMode = "list" | "grid"
const VIEW_MODE_KEY = "zv-devices-view-mode"
function readViewMode(): ViewMode {
  if (typeof localStorage === "undefined") return "list"
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY)
    return v === "grid" ? "grid" : "list"
  } catch {
    return "list"
  }
}

export function DevicesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })

  // Two orthogonal multi-select dimensions: connection (is the tunnel
  // up right now?) and peer (admin lifecycle). Empty set = no constraint
  // on that dimension — same behaviour as picking every option.
  const [connFilter, setConnFilter] = useState<Set<ConnState>>(new Set())
  const [peerFilter, setPeerFilter] = useState<Set<PeerState>>(new Set())
  const [query, setQuery] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  // List vs grid presentation toggle, persisted across visits via
  // localStorage so a user who prefers one layout doesn't get bounced
  // back to the default every reload. Filters / search / drag-reorder
  // all work identically in both modes — only the cell geometry changes.
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode)
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode)
    } catch {
      // localStorage can throw in restricted contexts (private mode,
      // quota); preferences are non-essential, swallow it.
    }
  }, [viewMode])
  const [revokeId, setRevokeId] = useState<string | null>(null)
  // Pause / resume both flip the live tunnel state for the user, so each
  // is gated behind its own confirm. `pauseId` / `unpauseId` hold the
  // pending device id while their respective dialog is open.
  const [pauseId, setPauseId] = useState<string | null>(null)
  const [unpauseId, setUnpauseId] = useState<string | null>(null)

  const liveDevices = useLiveStats((s) => s.devices)
  const rates = useMemo(() => {
    const m = new Map<string, { rxBps: number; txBps: number }>()
    for (const [id, d] of Object.entries(liveDevices)) {
      m.set(id, { rxBps: d.rxBps, txBps: d.txBps })
    }
    return m
  }, [liveDevices])

  const pauseM = useMutation({
    mutationFn: (id: string) => pauseDevice(id),
    onSuccess: () => {
      setPauseId(null)
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.info("Device paused")
    },
  })
  const unpauseM = useMutation({
    mutationFn: (id: string) => unpauseDevice(id),
    onSuccess: () => {
      setUnpauseId(null)
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device active")
    },
  })
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteDevice(id),
    onSuccess: () => {
      setRevokeId(null)
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.warning("Device revoked")
    },
  })

  // Optimistic-reorder: we update the React Query cache up front so the
  // table reflects the new order the instant the user drops, then fire
  // the bulk PUT. On error we rollback to the previous cache snapshot
  // and toast — server stays authoritative on next refetch.
  const reorderM = useMutation({
    mutationFn: (ids: string[]) => reorderDevices(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ["devices"] })
      const prev = qc.getQueryData<PublicDevice[]>(["devices"])
      if (prev) {
        const byId = new Map(prev.map((d) => [d.id, d]))
        const reordered = ids
          .map((id) => byId.get(id))
          .filter((d): d is PublicDevice => d !== undefined)
        // Preserve any rows the caller didn't include (shouldn't happen,
        // but defensively appends them at the end so nothing disappears).
        const seen = new Set(ids)
        for (const d of prev) if (!seen.has(d.id)) reordered.push(d)
        qc.setQueryData<PublicDevice[]>(["devices"], reordered)
      }
      return { prev }
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["devices"], ctx.prev)
      toast.error("Failed to save device order")
    },
    onSuccess: () => {
      toast.success("Order saved")
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["devices"] })
    },
  })

  // Drag-and-drop state: which device id is currently being dragged, and
  // which row the pointer is hovering over (for the visual indicator).
  // Both clear on dragend / drop. Kept as plain state — no library.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const devices = devicesQ.data ?? []

  // Derive both axes once and cache so the table cells and filter counts
  // agree without recomputing per render.
  const decorated = useMemo(
    () => devices.map((d) => ({ d, c: connState(d), p: peerState(d) })),
    [devices],
  )

  const counts = useMemo(() => {
    const c = { online: 0, offline: 0, live: 0, paused: 0, revoked: 0 }
    for (const row of decorated) {
      c[row.c] += 1
      c[row.p] += 1
    }
    return c
  }, [decorated])

  const filtered = useMemo(() => {
    const ql = query.trim().toLowerCase()
    return decorated.filter(({ d, c, p }) => {
      if (connFilter.size > 0 && !connFilter.has(c)) return false
      if (peerFilter.size > 0 && !peerFilter.has(p)) return false
      if (ql && !d.name.toLowerCase().includes(ql) && !d.allocated_ip.includes(ql)) {
        return false
      }
      return true
    })
  }, [decorated, connFilter, peerFilter, query])

  const totalFilters = connFilter.size + peerFilter.size
  const toggleConn = (v: ConnState) =>
    setConnFilter((prev) => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })
  const togglePeer = (v: PeerState) =>
    setPeerFilter((prev) => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })
  const clearFilters = () => {
    setConnFilter(new Set())
    setPeerFilter(new Set())
  }

  // Drop handler: build the next full ordering by moving `dragId` to
  // `dropTargetId`'s position WITHIN the underlying `devices` array
  // (not the filtered view). That way reorder-while-filtered still does
  // the obvious thing for the user — the two visible rows swap relative
  // positions in the persistent list. No-op if the filter is hiding
  // either endpoint or the ids are the same.
  const onDropOn = (targetId: string) => {
    const src = dragId
    setDragId(null)
    setDropTargetId(null)
    if (!src || src === targetId) return
    const ids = devices.map((d) => d.id)
    const fromIdx = ids.indexOf(src)
    const toIdx = ids.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    const next = ids.slice()
    next.splice(fromIdx, 1)
    next.splice(toIdx, 0, src)
    if (next.every((id, i) => id === ids[i])) return // unchanged
    reorderM.mutate(next)
  }

  // Throughput summary scoped to the *currently filtered* device set,
  // and then narrowed again to devices that are actually `online` — an
  // offline or never-handshaked device cannot be transmitting, so any
  // rate the WS store still holds for it is stale and must not be
  // surfaced as live data.
  const onlineFilteredIds = useMemo(
    () => filtered.filter(({ c }) => c === "online").map(({ d }) => d.id),
    [filtered],
  )
  const filteredTotalRxBps = useMemo(() => {
    let s = 0
    for (const id of onlineFilteredIds) s += rates.get(id)?.rxBps ?? 0
    return s
  }, [onlineFilteredIds, rates])
  const filteredTotalTxBps = useMemo(() => {
    let s = 0
    for (const id of onlineFilteredIds) s += rates.get(id)?.txBps ?? 0
    return s
  }, [onlineFilteredIds, rates])
  const filteredRxHistory = useMemo(
    () => sumHistoriesRightAligned(onlineFilteredIds, liveDevices, "rxHistory", 32),
    [onlineFilteredIds, liveDevices],
  )
  const filteredTxHistory = useMemo(
    () => sumHistoriesRightAligned(onlineFilteredIds, liveDevices, "txHistory", 32),
    [onlineFilteredIds, liveDevices],
  )

  // OS breakdown of the *currently filtered* fleet — fixed, useful at-a-
  // glance composition view that the table itself doesn't surface
  // visually. Counts per OS plus how many of each are currently online,
  // sorted by total descending so the biggest cohorts read first.
  const osBreakdown = useMemo(() => {
    const acc = new Map<DeviceOs, { os: DeviceOs; total: number; online: number }>()
    for (const { d, c } of filtered) {
      const cur = acc.get(d.os) ?? { os: d.os, total: 0, online: 0 }
      cur.total += 1
      if (c === "online") cur.online += 1
      acc.set(d.os, cur)
    }
    const rows = Array.from(acc.values()).sort((a, b) => b.total - a.total)
    const peak = rows[0]?.total ?? 0
    return { rows, peak }
  }, [filtered])

  return (
    <PageStagger>
      <StaggerItem>
      <PageHead
        eyebrow="Workspace · 02"
        title="Devices"
        right={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconPlus />
                Add device
              </Button>
            </DialogTrigger>
            <AddDeviceDialog
              onCreated={(d) => {
                // Dialog showed QR + config on step 2; on Done we close it
                // and land the user on the new device's detail page so they
                // can verify the row is live without hunting for it.
                setAddOpen(false)
                navigate(`/app/devices/${d.device.id}`)
              }}
            />
          </Dialog>
        }
      />
      </StaggerItem>

      <StaggerItem>
      <FleetSummary
        devices={devices}
        filteredCount={filtered.length}
        counts={counts}
        totalRxBps={filteredTotalRxBps}
        totalTxBps={filteredTotalTxBps}
        rxHistory={filteredRxHistory}
        txHistory={filteredTxHistory}
        osBreakdown={osBreakdown}
        loading={devicesQ.isLoading}
      />
      </StaggerItem>

      <StaggerItem>
      <Panel
        flush
        right={
          <>
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
            <div className="flex flex-wrap items-center gap-2">
              <FilterDropdown<ConnState>
                label="Connection"
                options={CONN_FILTERS}
                selected={connFilter}
                onToggle={toggleConn}
                onClear={() => setConnFilter(new Set())}
                counts={counts}
              />
              <FilterDropdown<PeerState>
                label="Peer"
                options={PEER_FILTERS}
                selected={peerFilter}
                onToggle={togglePeer}
                onClear={() => setPeerFilter(new Set())}
                counts={counts}
              />
              {totalFilters > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-muted-foreground hover:text-foreground font-mono text-[11px] underline-offset-2 hover:underline"
                >
                  clear all
                </button>
              )}
            </div>
            <div className="relative">
              <IconSearch
                size={12}
                className="text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="h-7 w-48 pl-6 font-mono text-xs"
              />
              {query && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground absolute right-1 top-1/2 -translate-y-1/2"
                  onClick={() => setQuery("")}
                  aria-label="Clear filter"
                >
                  <IconX size={12} />
                </button>
              )}
            </div>
          </>
        }
      >
        {devicesQ.isLoading && (
          <div className="p-4">
            <Skeleton className="h-40 rounded-none" />
          </div>
        )}
        {devicesQ.isError && (
          <p className="text-destructive p-4 font-mono text-sm">
            Failed to load devices.
          </p>
        )}
        {devicesQ.data && devicesQ.data.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={IconDeviceTablet}
              title="No devices yet"
              description="Add your first device to receive a WireGuard config."
              action={
                <Button onClick={() => setAddOpen(true)}>
                  <IconPlus />
                  Add device
                </Button>
              }
            />
          </div>
        )}
        {devicesQ.data && devicesQ.data.length > 0 && filtered.length === 0 && (
          <p className="text-muted-foreground p-4 font-mono text-sm">
            No devices match the current filter.
          </p>
        )}
        {filtered.length > 0 && viewMode === "list" && (
          <table className="zv-table zv-table-draggable">
            <thead>
              <tr>
                <th className="w-6" aria-label="Drag handle" />
                <th>Name</th>
                <th>OS</th>
                <th>VPN IP</th>
                <th>Allowed IPs</th>
                <th>DNS</th>
                <th>Status</th>
                <th className="zv-num">TX</th>
                <th className="zv-num">RX</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ d, c, p }) => {
                const live = rates.get(d.id) ?? { rxBps: 0, txBps: 0 }
                const isSplit =
                  d.allowed_ips_override !== null &&
                  d.allowed_ips_override !== undefined &&
                  d.allowed_ips_override.length > 0
                const dnsDisplay =
                  d.dns_override && d.dns_override.length > 0
                    ? d.dns_override.join(", ")
                    : "server default"
                const rowStatus = rowPill(c, p)
                const isDragging = dragId === d.id
                const isDropTarget = dropTargetId === d.id && dragId !== null && dragId !== d.id
                return (
                  <tr
                    key={d.id}
                    data-dragging={isDragging ? "1" : undefined}
                    data-drop-target={isDropTarget ? "1" : undefined}
                    // Double-click anywhere on the row opens detail. We let
                    // the Name <Link> handle single-click navigation as
                    // before; this is the "any cell" affordance.
                    onDoubleClick={() => navigate(`/app/devices/${d.id}`)}
                    onDragOver={(e) => {
                      // Standard HTML5 drop target wiring: cancelling the
                      // dragover event marks the element as a valid drop
                      // zone. We also track which row the pointer is over
                      // for the visual indicator.
                      if (!dragId || dragId === d.id) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = "move"
                      if (dropTargetId !== d.id) setDropTargetId(d.id)
                    }}
                    onDragLeave={() => {
                      if (dropTargetId === d.id) setDropTargetId(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      onDropOn(d.id)
                    }}
                  >
                    <td
                      className="zv-drag-handle"
                      draggable
                      onDragStart={(e) => {
                        setDragId(d.id)
                        e.dataTransfer.effectAllowed = "move"
                        // Firefox requires SOMETHING in dataTransfer to
                        // initiate a drag; the value isn't used by us.
                        e.dataTransfer.setData("text/plain", d.id)
                      }}
                      onDragEnd={() => {
                        setDragId(null)
                        setDropTargetId(null)
                      }}
                      title="Drag to reorder"
                    >
                      <IconGripVertical size={14} />
                    </td>
                    <td>
                      <Link
                        to={`/app/devices/${d.id}`}
                        className="hover:text-foreground inline-flex items-center gap-2 font-medium"
                      >
                        <StatusPill status={rowStatus} dotOnly />
                        {d.name}
                        {isSplit && <span className="zv-kbd">split</span>}
                      </Link>
                    </td>
                    <td className="text-muted-foreground">{d.os}</td>
                    <td className="font-mono">{d.allocated_ip}</td>
                    <td
                      className="text-muted-foreground max-w-[180px] truncate font-mono"
                      title={
                        isSplit
                          ? d.allowed_ips_override!.join(", ")
                          : "0.0.0.0/0, ::/0"
                      }
                    >
                      {isSplit
                        ? d.allowed_ips_override!.join(", ")
                        : "0.0.0.0/0, ::/0"}
                    </td>
                    <td
                      className="text-muted-foreground max-w-[140px] truncate font-mono"
                      title={dnsDisplay}
                    >
                      {dnsDisplay}
                    </td>
                    <td>
                      <div className="inline-flex items-center gap-1.5">
                        <StatusPill status={c} />
                        {p !== "live" && <StatusPill status={p === "paused" ? "paused" : "revoked"} />}
                      </div>
                    </td>
                    <td className="zv-num">
                      {c === "online" ? (
                        formatRate(live.txBps)
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="zv-num">
                      {c === "online" ? (
                        formatRate(live.rxBps)
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="text-muted-foreground font-mono text-xs">
                      {formatLastSeen(d.last_handshake_at)}
                    </td>
                    <td className="zv-actions">
                      <RowActions
                        device={d}
                        onPause={() => setPauseId(d.id)}
                        onUnpause={() => setUnpauseId(d.id)}
                        onRevoke={() => setRevokeId(d.id)}
                        pending={pauseM.isPending || unpauseM.isPending}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {filtered.length > 0 && viewMode === "grid" && (
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(({ d }) => {
              const isDragging = dragId === d.id
              const isDropTarget =
                dropTargetId === d.id && dragId !== null && dragId !== d.id
              return (
                <DeviceCard
                  key={d.id}
                  device={d}
                  draggable
                  data-dragging={isDragging ? "1" : undefined}
                  data-drop-target={isDropTarget ? "1" : undefined}
                  onDoubleClick={() => navigate(`/app/devices/${d.id}`)}
                  onDragStart={(e) => {
                    setDragId(d.id)
                    e.dataTransfer.effectAllowed = "move"
                    e.dataTransfer.setData("text/plain", d.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setDropTargetId(null)
                  }}
                  onDragOver={(e) => {
                    if (!dragId || dragId === d.id) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "move"
                    if (dropTargetId !== d.id) setDropTargetId(d.id)
                  }}
                  onDragLeave={() => {
                    if (dropTargetId === d.id) setDropTargetId(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    onDropOn(d.id)
                  }}
                  actions={
                    <RowActions
                      device={d}
                      onPause={() => setPauseId(d.id)}
                      onUnpause={() => setUnpauseId(d.id)}
                      onRevoke={() => setRevokeId(d.id)}
                      pending={pauseM.isPending || unpauseM.isPending}
                    />
                  }
                />
              )
            })}
          </div>
        )}
      </Panel>
      </StaggerItem>

      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(o) => !o && setRevokeId(null)}
        title="Revoke device?"
        description="This removes the peer from WireGuard, frees its IP, and is irreversible. The user must add a new device to reconnect."
        confirmLabel="Revoke"
        destructive
        pending={deleteM.isPending}
        onConfirm={() => revokeId && deleteM.mutate(revokeId)}
      />

      <ConfirmDialog
        open={!!pauseId}
        onOpenChange={(o) => !o && setPauseId(null)}
        title="Pause device?"
        description="The peer is removed from WireGuard until you resume it. The device's IP is held — no traffic is tunnelled while paused."
        confirmLabel="Pause"
        pending={pauseM.isPending}
        onConfirm={() => pauseId && pauseM.mutate(pauseId)}
      />

      <ConfirmDialog
        open={!!unpauseId}
        onOpenChange={(o) => !o && setUnpauseId(null)}
        title="Resume device?"
        description="The peer is re-added to WireGuard with its previously allocated IP. Traffic will start tunnelling as soon as the device handshakes."
        confirmLabel="Resume"
        pending={unpauseM.isPending}
        onConfirm={() => unpauseId && unpauseM.mutate(unpauseId)}
      />
    </PageStagger>
  )
}

/** Right-align and sum N device history arrays into a single series of
 *  the given window. Same right-alignment logic the live-stats aggregate
 *  uses, but scoped to a caller-supplied id list so the chart can reflect
 *  the current filter. */
function sumHistoriesRightAligned(
  ids: string[],
  source: Record<string, { rxHistory: number[]; txHistory: number[] }>,
  key: "rxHistory" | "txHistory",
  windowSize: number,
): number[] {
  let maxLen = 0
  const slices: number[][] = []
  for (const id of ids) {
    const arr = source[id]?.[key] ?? []
    if (arr.length === 0) continue
    const s = arr.slice(-windowSize)
    slices.push(s)
    if (s.length > maxLen) maxLen = s.length
  }
  if (maxLen === 0) return []
  const out = new Array<number>(maxLen).fill(0)
  for (const s of slices) {
    const offset = maxLen - s.length
    for (let i = 0; i < s.length; i++) {
      out[offset + i] += s[i]
    }
  }
  return out
}

/** Top-of-page fleet summary. One Swiss card divided into three
 *  hairline-separated sections: Fleet (counts + online bar), Throughput
 *  (live TX/RX for the *filtered* set, with sparklines), Top traffic
 *  (top-3 ranked by current rate). Everything respects the current
 *  filter so the card and table never disagree. */
function FleetSummary({
  devices,
  filteredCount,
  counts,
  totalRxBps,
  totalTxBps,
  rxHistory,
  txHistory,
  osBreakdown,
  loading,
}: {
  devices: PublicDevice[]
  filteredCount: number
  counts: { online: number; offline: number; live: number; paused: number; revoked: number }
  totalRxBps: number
  totalTxBps: number
  rxHistory: number[]
  txHistory: number[]
  osBreakdown: {
    rows: { os: DeviceOs; total: number; online: number }[]
    peak: number
  }
  loading: boolean
}) {
  const hasAnyHistory =
    rxHistory.some((v) => v > 0) || txHistory.some((v) => v > 0)
  const isFiltered = filteredCount !== devices.length
  return (
    <Panel className="zv-fleet-summary">
      <div className="grid grid-cols-1 gap-0 md:grid-cols-3">
        {/* ── Section 1 · Fleet ───────────────────────────────────────── */}
        <div className="border-border flex flex-col gap-3 p-5 md:border-r">
          <SectionHeader num="01" label="Fleet" />
          <div className="flex items-baseline gap-3">
            <span className="font-heading text-foreground text-[40px] font-medium leading-none tracking-[-0.02em] tabular-nums">
              {loading ? "—" : devices.length}
            </span>
            <span className="text-muted-foreground font-mono text-xs">
              {devices.length === 1 ? "device" : "devices"}
            </span>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
            <span>
              <strong className="text-status-online tabular-nums">
                {counts.online}
              </strong>{" "}
              online
            </span>
            <span>
              <strong className="text-foreground/60 tabular-nums">
                {counts.offline}
              </strong>{" "}
              offline
            </span>
            {counts.paused > 0 && (
              <span>
                <strong className="text-status-degraded tabular-nums">
                  {counts.paused}
                </strong>{" "}
                paused
              </span>
            )}
            {counts.revoked > 0 && (
              <span>
                <strong className="text-destructive tabular-nums">
                  {counts.revoked}
                </strong>{" "}
                revoked
              </span>
            )}
          </div>
        </div>

        {/* ── Section 2 · Throughput (respects filter) ───────────────── */}
        <div className="border-border flex flex-col gap-3 p-5 md:border-r">
          <SectionHeader
            num="02"
            label="Throughput · live"
            hint={`${counts.online} online${isFiltered ? " · filtered" : ""}`}
          />
          <div className="grid grid-cols-2 gap-4">
            <FleetRate
              label="TX"
              value={totalTxBps}
              color="var(--primary)"
              spark={rxHistory.length > 0 ? txHistory.slice(-32) : []}
            />
            <FleetRate
              label="RX"
              value={totalRxBps}
              color="var(--chart-1)"
              spark={rxHistory.slice(-32)}
            />
          </div>
          {!hasAnyHistory && (
            <p className="text-muted-foreground/70 font-mono text-[10px]">
              {filteredCount === 0
                ? "no devices match the current filter"
                : counts.online === 0
                  ? "no online devices — nothing transmitting"
                  : "waiting for first stats sample…"}
            </p>
          )}
        </div>

        {/* ── Section 3 · OS distribution ─────────────────────────────── */}
        <div className="flex flex-col gap-3 p-5">
          <SectionHeader
            num="03"
            label="By OS"
            hint={
              osBreakdown.rows.length > 0
                ? `${osBreakdown.rows.length} ${osBreakdown.rows.length === 1 ? "type" : "types"}`
                : undefined
            }
          />
          {osBreakdown.rows.length === 0 ? (
            <p className="text-muted-foreground/70 font-mono text-[11px]">
              no devices match the current filter
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {osBreakdown.rows.map((row) => (
                <OsBreakdownRow
                  key={row.os}
                  os={row.os}
                  total={row.total}
                  online={row.online}
                  peak={osBreakdown.peak}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

/** Section header — bigger, more confident eyebrow than the inline
 *  `<Eyebrow>` so the three columns read as proper dashboard cards. */
function SectionHeader({
  num,
  label,
  hint,
}: {
  num: string
  label: string
  hint?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-baseline gap-2 font-mono">
        <span className="text-foreground/40 text-[11px] tracking-[0.08em]">
          {num}
        </span>
        <span className="text-foreground text-[11px] uppercase tracking-[0.1em]">
          {label}
        </span>
      </div>
      {hint && (
        <span className="text-muted-foreground/70 font-mono text-[10px]">
          {hint}
        </span>
      )}
    </div>
  )
}

function FleetRate({
  label,
  value,
  color,
  spark,
}: {
  label: string
  value: number
  color: string
  spark: number[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.08em]">
        {label}
      </div>
      <div className="font-heading text-foreground text-[22px] font-medium leading-none tracking-[-0.01em] tabular-nums">
        {formatRate(value)}
      </div>
      <div className="-mt-0.5 h-[22px]">
        {spark.length > 1 ? (
          <Sparkline data={spark} color={color} height={22} />
        ) : (
          <div className="text-muted-foreground/40 font-mono text-[10px]">
            no samples yet
          </div>
        )}
      </div>
    </div>
  )
}

const OS_LABELS: Record<DeviceOs, string> = {
  ios: "iOS",
  android: "Android",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  other: "Other",
}

/** Single row in the OS-distribution panel — OS label on the left, a
 *  hairline bar showing this OS's share of the largest cohort, and a
 *  `online / total` count on the right. Gives an at-a-glance read of
 *  fleet composition that the table below doesn't surface visually. */
function OsBreakdownRow({
  os,
  total,
  online,
  peak,
}: {
  os: DeviceOs
  total: number
  online: number
  peak: number
}) {
  const pct = peak > 0 ? Math.max(6, (total / peak) * 100) : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
        <span className="text-foreground font-medium">
          {OS_LABELS[os] ?? os}
        </span>
        <span className="text-muted-foreground tabular-nums">
          <span className="text-status-online">{online}</span>
          <span className="text-muted-foreground/60"> / </span>
          <span className="text-foreground">{total}</span>
          <span className="text-muted-foreground/70 ml-1">online</span>
        </span>
      </div>
      <div className="border-border relative h-1 border bg-card">
        <div
          className="bg-primary absolute inset-y-0 left-0"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** Two-button segmented toggle for switching the devices listing between
 *  table layout (list) and card layout (grid). Compact, mono-styled to
 *  match the rest of the panel toolbar. */
function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode
  onChange: (v: ViewMode) => void
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="border-border inline-flex h-7 shrink-0 overflow-hidden border"
    >
      <ViewModeButton
        active={value === "list"}
        onClick={() => onChange("list")}
        label="List view"
      >
        <IconLayoutList size={13} />
      </ViewModeButton>
      <ViewModeButton
        active={value === "grid"}
        onClick={() => onChange("grid")}
        label="Grid view"
      >
        <IconLayoutGrid size={13} />
      </ViewModeButton>
    </div>
  )
}

function ViewModeButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      data-active={active ? "1" : "0"}
      className="text-muted-foreground hover:text-foreground data-[active=1]:bg-muted/60 data-[active=1]:text-foreground inline-flex w-7 items-center justify-center transition-colors first:border-r first:border-border"
    >
      {children}
    </button>
  )
}

function RowActions({
  device,
  onPause,
  onUnpause,
  onRevoke,
  pending,
}: {
  device: PublicDevice
  onPause: () => void
  onUnpause: () => void
  onRevoke: () => void
  pending: boolean
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {device.status === "active" && (
        <IconBtn onClick={onPause} title="Pause">
          <IconPlayerPause size={12} />
        </IconBtn>
      )}
      {device.status === "paused" && (
        <IconBtn onClick={onUnpause} title="Unpause">
          <IconPlayerPlay size={12} />
        </IconBtn>
      )}
      {device.status !== "revoked" && (
        <IconBtn
          onClick={onRevoke}
          title={pending ? "Working…" : "Revoke"}
          className="hover:text-destructive hover:border-destructive"
        >
          ×
        </IconBtn>
      )}
    </span>
  )
}

type IpMode = "auto" | "custom"

function AddDeviceDialog({
  onCreated,
}: {
  onCreated: (d: CreatedDevice) => void
}) {
  const qc = useQueryClient()
  const user = useAuth((s) => s.user)
  // Fetch the user's WG server info (cidr, default DNS, endpoint) so we
  // can seed sensible defaults: split tunnel ON pointing at the WG
  // subnet, custom-DNS box pre-filled with the server's resolver, and a
  // "must be inside <cidr>" hint under the IP input. Cached for the
  // session — server config almost never changes mid-flight.
  const serverInfoQ = useQuery({
    queryKey: ["me", "server"],
    queryFn: meServer,
    staleTime: 5 * 60_000,
  })
  const serverCidr = serverInfoQ.data?.cidr
  const serverDns = serverInfoQ.data?.dns_servers ?? []
  const serverDnsDefault = serverDns.join(", ")

  // Existing devices for the inline name-uniqueness check. Shares the
  // same query key the parent table uses, so cache is reused — no extra
  // network round-trip.
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
  const existingNames = useMemo(
    () =>
      new Set(
        (devicesQ.data ?? []).map((d) => d.name.trim().toLowerCase()),
      ),
    [devicesQ.data],
  )

  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState("")
  const [osChoice, setOsChoice] = useState<DeviceOs>("other")
  // Split tunnel defaults ON now: most users only need the VPN for
  // reaching peer devices on the WG subnet, not for routing all their
  // traffic. The pre-set CIDR is the server's subnet, so this is also
  // accurate (not just an arbitrary RFC1918 mask).
  const [splitTunnel, setSplitTunnel] = useState(true)
  // Pre-fill the custom DNS with the server's default resolver so the
  // box shows what they'll actually get when they leave it alone, and
  // is editable if they want to point at 1.1.1.1 / a corp DNS / etc.
  const [dnsInput, setDnsInput] = useState("")
  // When server info lands, seed the DNS input once. Subsequent edits by
  // the user are preserved (we only assign when the box is still empty).
  // The set-state-in-effect lint rule warns about cascading renders, but
  // this is the documented React pattern for "one-time seed from async
  // data" — the guard on `dnsInput === ""` makes it idempotent.
  useEffect(() => {
    if (serverDnsDefault && dnsInput === "") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDnsInput(serverDnsDefault)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDnsDefault])
  const [ipMode, setIpMode] = useState<IpMode>("auto")
  const [ipInput, setIpInput] = useState("")
  // DNS-name prefix the device will be reachable at (the suffix is the
  // server-fixed `.vpn.local`). Auto-derived from the device name and
  // the user's email-local part on every keystroke, UNTIL the user
  // edits the field themselves — at which point `dnsTouched` flips and
  // their custom value sticks.
  const [dnsPrefix, setDnsPrefix] = useState("")
  const [dnsTouched, setDnsTouched] = useState(false)
  // Default OFF — preserves the historical zero-knowledge guarantee.
  // Toggle ON to let the server store the WG private key (KEK-encrypted)
  // so the user can re-download the .conf later without rotating keys.
  const [storePrivateKey, setStorePrivateKey] = useState(false)
  const [result, setResult] = useState<CreatedDevice | null>(null)

  const dnsLooksValid = useMemo(() => {
    if (!dnsInput.trim()) return true
    const parts = dnsInput.split(",").map((s) => s.trim()).filter(Boolean)
    return parts.every((p) => /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/.test(p))
  }, [dnsInput])

  // Slugs feed the auto-derived DNS prefix. Per-label cap is 30 chars
  // (mirrors the server regex). Hyphens are tolerated everywhere except
  // the leading and trailing positions of each label.
  const userSlug = useMemo(
    () => dnsLabelSlug(user?.email?.split("@")[0] ?? ""),
    [user?.email],
  )
  const nameSlug = useMemo(() => dnsLabelSlug(name), [name])

  // The default prefix is `<device>.<user>` when both labels resolve to
  // something non-empty, else whichever is present. Empty when nothing
  // useful is available yet (e.g. before the user has typed a name).
  const defaultDnsPrefix = useMemo(() => {
    if (nameSlug && userSlug) return `${nameSlug}.${userSlug}`
    return nameSlug || userSlug
  }, [nameSlug, userSlug])

  // Mirror the default into the input until the user edits it. Once
  // `dnsTouched` flips, we leave their value alone — same idiom used for
  // the seeded DNS resolver field above.
  useEffect(() => {
    if (!dnsTouched) setDnsPrefix(defaultDnsPrefix)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDnsPrefix])

  const dnsFqdn = dnsPrefix ? `${dnsPrefix}.vpn.local` : ""

  // Debounced server-side availability probe. We hold the typed value
  // for 350 ms before firing — long enough that fast typists don't
  // pay one /dns-check per keystroke, short enough that the UX still
  // feels live.
  const [debouncedFqdn, setDebouncedFqdn] = useState("")
  useEffect(() => {
    if (!dnsFqdn) {
      setDebouncedFqdn("")
      return
    }
    const t = setTimeout(() => setDebouncedFqdn(dnsFqdn), 350)
    return () => clearTimeout(t)
  }, [dnsFqdn])

  const dnsPrefixLocallyValid =
    dnsPrefix.length > 0 && isValidDnsPrefix(dnsPrefix)

  const dnsCheckQ = useQuery<DnsCheck>({
    queryKey: ["dns-check", debouncedFqdn],
    queryFn: () => checkDnsName(debouncedFqdn),
    // Only hit the server once the prefix at least parses locally —
    // otherwise we just waste a request that's certain to say "invalid".
    enabled: debouncedFqdn.length > 0 && dnsPrefixLocallyValid,
    staleTime: 30_000,
    retry: false,
  })

  const dnsNameTaken =
    dnsCheckQ.data?.valid === true && dnsCheckQ.data.available === false
  const dnsNameAvailable =
    dnsCheckQ.data?.valid === true && dnsCheckQ.data.available === true

  const nameTaken =
    name.trim().length > 0 && existingNames.has(name.trim().toLowerCase())

  // Validate the custom IP as the user types. Distinguish three cases so
  // the inline hint can be specific:
  //   - empty (custom mode): not submittable, but no error shown yet
  //   - malformed octets: "not a valid IPv4 address"
  //   - well-formed but outside / on a reserved slot of the server CIDR:
  //     "outside 10.42.0.0/24" / "gateway address (reserved)" / etc.
  // For auto mode the validation is always ok.
  const ipValidation = useMemo<{ ok: boolean; error: string | null }>(() => {
    if (ipMode === "auto") return { ok: true, error: null }
    const v = ipInput.trim()
    if (!v) return { ok: false, error: null }
    if (
      !/^(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})$/.test(
        v,
      )
    ) {
      return { ok: false, error: "that doesn't look like a valid IPv4 address" }
    }
    if (serverCidr) {
      const reason = ipOutsideCidrReason(v, serverCidr)
      if (reason) return { ok: false, error: reason }
    }
    return { ok: true, error: null }
  }, [ipMode, ipInput, serverCidr])
  const ipLooksValid = ipValidation.ok

  const addM = useMutation({
    mutationFn: async () => {
      const dns = dnsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const created = await createDevice({
        name: name.trim(),
        os: osChoice,
        split_tunnel: splitTunnel || undefined,
        dns_override: dns.length > 0 ? dns : undefined,
        allocated_ip:
          ipMode === "custom" && ipInput.trim() ? ipInput.trim() : undefined,
        store_private_key: storePrivateKey || undefined,
      })
      // Best-effort: attach the requested DNS name as a second step so
      // the device row exists either way. A failure here surfaces as
      // a warning, not a hard error — the user can retry from the
      // device detail page.
      if (dnsFqdn) {
        try {
          await setDeviceDns(created.device.id, [dnsFqdn])
        } catch (e) {
          const msg =
            e instanceof ApiError
              ? e.message
              : "DNS name could not be saved"
          toast.warning(`Device created — ${msg}`)
        }
      }
      return created
    },
    onSuccess: (data) => {
      setResult(data)
      setStep(2)
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.success("Device added")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
      else toast.error("Failed to create device")
    },
  })

  const canSubmit =
    name.trim().length > 0 &&
    name.trim().length <= 64 &&
    !nameTaken &&
    dnsLooksValid &&
    ipLooksValid &&
    // DNS prefix is required (auto-filled from name + user, but the
    // user can clear it — at that point we don't have a hostname to
    // register, which we don't allow on create). Must be locally
    // valid AND have come back from /dns-check as available.
    dnsPrefixLocallyValid &&
    dnsNameAvailable &&
    !addM.isPending

  const resetAll = () => {
    setStep(1)
    setName("")
    setOsChoice("other")
    setSplitTunnel(false)
    setDnsInput("")
    setIpMode("auto")
    setIpInput("")
    setStorePrivateKey(false)
    setResult(null)
    setDnsPrefix("")
    setDnsTouched(false)
  }

  return (
    <DialogContent className="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>
          <Eyebrow num={`0${step}/02`}>Add device</Eyebrow>
        </DialogTitle>
        <DialogDescription>
          We generate a fresh keypair, allocate an IP, and hand you a WireGuard
          config. The private key never leaves the page.
        </DialogDescription>
      </DialogHeader>

      {step === 1 && (
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dev-name" className="zv-eyebrow">
              Device name
            </Label>
            <Input
              id="dev-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="macbook-pro · pixel-8 · home-server"
              className="font-mono"
              autoFocus
              maxLength={64}
              aria-invalid={nameTaken}
            />
            <p className="text-muted-foreground font-mono text-[11px]">
              1–64 chars. Used as the WireGuard interface name on the device.
              {nameTaken && (
                <span className="text-destructive ml-2">
                  you already have a device with this name
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="zv-eyebrow">Operating system</Label>
            <Select
              value={osChoice}
              onValueChange={(v) => setOsChoice(v as DeviceOs)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["ios", "android", "macos", "windows", "linux", "other"] as DeviceOs[]
                ).map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* DNS name. Default is `<device>.<user>.vpn.local`, but the
              prefix is editable and the suffix is fixed (server regex).
              The /dns-check probe runs as the user types, debounced. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dev-dns-name" className="zv-eyebrow">
              DNS name
            </Label>
            <div
              data-invalid={
                (dnsPrefix.length > 0 && !dnsPrefixLocallyValid) ||
                dnsNameTaken
                  ? "1"
                  : undefined
              }
              className="border-input bg-transparent focus-within:border-ring focus-within:ring-ring/50 data-[invalid=1]:border-destructive data-[invalid=1]:ring-destructive/20 flex h-8 items-stretch overflow-hidden rounded-lg border transition-colors focus-within:ring-3 data-[invalid=1]:ring-3"
            >
              <input
                id="dev-dns-name"
                value={dnsPrefix}
                onChange={(e) => {
                  setDnsTouched(true)
                  setDnsPrefix(e.target.value.toLowerCase())
                }}
                placeholder={defaultDnsPrefix || "macbook-pro.bhadri"}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent px-2.5 py-1 font-mono text-sm outline-none"
              />
              <span className="border-input bg-muted/40 text-muted-foreground inline-flex shrink-0 items-center border-l px-2.5 font-mono text-[12px]">
                .vpn.local
              </span>
            </div>
            <DnsNameStatus
              prefix={dnsPrefix}
              locallyValid={dnsPrefixLocallyValid}
              checking={
                dnsCheckQ.isFetching && debouncedFqdn === dnsFqdn
              }
              taken={dnsNameTaken}
              available={dnsNameAvailable}
              defaultPrefix={defaultDnsPrefix}
              touched={dnsTouched}
              onReset={() => {
                setDnsTouched(false)
                setDnsPrefix(defaultDnsPrefix)
              }}
            />
          </div>

          {/* IP allocation — two-mode picker with conditional input. */}
          <div className="flex flex-col gap-1.5">
            <Label className="zv-eyebrow">
              IP allocation
              {serverCidr && (
                <span className="text-muted-foreground/70 normal-case">
                  {" "}· subnet{" "}
                  <span className="text-foreground font-mono">
                    {serverCidr}
                  </span>
                </span>
              )}
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <IpModeOption
                selected={ipMode === "auto"}
                onClick={() => setIpMode("auto")}
                title="Auto-assign"
                sub={
                  serverCidr
                    ? `Server picks the next free address in ${serverCidr}.`
                    : "Server picks the next free address in the subnet."
                }
              />
              <IpModeOption
                selected={ipMode === "custom"}
                onClick={() => setIpMode("custom")}
                title="Choose IP"
                sub={
                  serverCidr
                    ? `Reserve a specific address inside ${serverCidr}.`
                    : "Reserve a specific address inside the server's CIDR."
                }
              />
            </div>
            {ipMode === "custom" && (
              <div className="mt-1 flex flex-col gap-2">
                {serverCidr && (() => {
                  const range = ipRangeFromCidr(serverCidr)
                  if (!range) return null
                  return (
                    <div className="border-border bg-muted/30 flex items-center justify-between gap-3 border px-3 py-2 font-mono text-[11px]">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-muted-foreground uppercase tracking-[0.08em] text-[10px]">
                          Usable range
                        </span>
                        <span className="text-foreground tabular-nums">
                          {range.first}
                          <span className="text-muted-foreground"> → </span>
                          {range.last}
                        </span>
                      </div>
                      <div className="text-muted-foreground/80 text-right">
                        <div className="tabular-nums">
                          {range.total.toLocaleString()}
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.08em]">
                          addresses
                        </div>
                      </div>
                    </div>
                  )
                })()}
                <Input
                  value={ipInput}
                  onChange={(e) => setIpInput(e.target.value)}
                  placeholder={
                    serverCidr ? ipPlaceholderFor(serverCidr) : "10.42.0.42"
                  }
                  className="font-mono"
                  aria-invalid={!ipLooksValid}
                  autoFocus
                />
                <p className="text-muted-foreground font-mono text-[11px]">
                  IPv4 only. Must be inside{" "}
                  <span className="text-foreground font-mono">
                    {serverCidr ?? "the server's subnet"}
                  </span>{" "}
                  and not already taken. Network / broadcast / gateway are
                  reserved.
                  {ipValidation.error && (
                    <span className="text-destructive ml-2">
                      {ipValidation.error}
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="border-border flex items-center gap-3 border p-3">
            <Switch
              checked={splitTunnel}
              onCheckedChange={setSplitTunnel}
              id="split-tunnel"
            />
            <Label
              htmlFor="split-tunnel"
              className="flex flex-1 cursor-pointer flex-col gap-0.5"
            >
              <span className="text-sm font-medium">Split tunnel</span>
              <span className="text-muted-foreground font-mono text-[11px]">
                {serverCidr
                  ? `Only ${serverCidr} routes through the tunnel — the rest of your traffic exits via your LAN. Default ON.`
                  : "Only the WG subnet routes through the tunnel — the rest of your traffic exits via your LAN. Default ON."}
              </span>
            </Label>
          </div>

          <div className="border-border flex items-center gap-3 border p-3">
            <Switch
              checked={storePrivateKey}
              onCheckedChange={setStorePrivateKey}
              id="store-key"
            />
            <Label
              htmlFor="store-key"
              className="flex flex-1 cursor-pointer flex-col gap-0.5"
            >
              <span className="text-sm font-medium">
                Store private key on server
              </span>
              <span className="text-muted-foreground font-mono text-[11px]">
                Encrypted with the server's KEK and saved on the device row
                so you can re-download the .conf later from any device.
                Trades the zero-knowledge default for convenience. Default OFF.
              </span>
            </Label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dev-dns" className="zv-eyebrow">
              Custom DNS{" "}
              <span className="text-muted-foreground/70 normal-case">
                · optional
              </span>
            </Label>
            <Input
              id="dev-dns"
              value={dnsInput}
              onChange={(e) => setDnsInput(e.target.value)}
              placeholder="1.1.1.1, 1.0.0.1"
              className="font-mono"
              aria-invalid={!dnsLooksValid}
            />
            <p className="text-muted-foreground font-mono text-[11px]">
              Comma-separated IPv4/IPv6 resolvers. Leave blank to use the
              server's defaults.
              {!dnsLooksValid && (
                <span className="text-destructive ml-2">
                  one or more entries don't look like an IP
                </span>
              )}
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={addM.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={() => addM.mutate()} disabled={!canSubmit}>
              {addM.isPending ? "Generating…" : "Generate config →"}
            </Button>
          </DialogFooter>
        </div>
      )}

      {step === 2 && result && (
        <div className="space-y-4">
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            The keypair was generated server-side for this peer; the private
            key is in the config below and{" "}
            <strong className="text-foreground">isn't stored</strong> after
            you dismiss this dialog.{" "}
            <span className="text-foreground">Save it now.</span>
          </p>

          <div className="border-border grid gap-0 border md:grid-cols-[auto_1fr]">
            <div className="border-border bg-card flex aspect-square shrink-0 items-center justify-center md:aspect-auto md:w-[180px] md:border-r">
              <span
                className="block size-[148px] [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: result.qr_svg }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-3 p-4">
              <div className="flex flex-col gap-1">
                <Eyebrow>Scan with WireGuard / mobile</Eyebrow>
                <p className="text-muted-foreground font-mono text-[11px]">
                  Allocated IP{" "}
                  <span className="text-foreground">
                    {result.device.allocated_ip}
                  </span>
                </p>
              </div>
              <div className="mt-auto grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    downloadConfig(result.device.name, result.config)
                  }
                >
                  <IconDownload size={14} />
                  Download .conf
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(result.config)
                    toast.success("Config copied")
                  }}
                >
                  <IconQrcode size={14} />
                  Copy config
                </Button>
              </div>
            </div>
          </div>

          <div className="max-h-[260px] overflow-y-auto">
            <CopyableCode value={result.config} multiline />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setStep(1)}>
              ← Back
            </Button>
            <Button
              onClick={() => {
                onCreated(result)
                resetAll()
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </div>
      )}
    </DialogContent>
  )
}

/** Inline status line under the DNS-name input. Communicates four
 *  states in a single row — empty, locally malformed, server probe in
 *  flight, taken, and available — so the user always knows exactly why
 *  the submit button is enabled or not. */
function DnsNameStatus({
  prefix,
  locallyValid,
  checking,
  taken,
  available,
  defaultPrefix,
  touched,
  onReset,
}: {
  prefix: string
  locallyValid: boolean
  checking: boolean
  taken: boolean
  available: boolean
  defaultPrefix: string
  touched: boolean
  onReset: () => void
}) {
  let body: React.ReactNode
  if (!prefix) {
    body = "Required. Defaults to <device>.<user>.vpn.local."
  } else if (!locallyValid) {
    body = (
      <span className="text-destructive">
        invalid hostname — labels are 1–30 lowercase chars (letters,
        digits, hyphens), separated by dots, no leading/trailing hyphen
      </span>
    )
  } else if (checking) {
    body = "Checking availability…"
  } else if (taken) {
    body = (
      <span className="text-destructive">
        already taken — try another label
      </span>
    )
  } else if (available) {
    body = (
      <span className="text-status-online">
        available — peers can resolve this device by this name
      </span>
    )
  } else {
    body = "Other peers will be able to resolve this device by this name."
  }
  const canReset = touched && defaultPrefix && prefix !== defaultPrefix
  return (
    <p className="text-muted-foreground flex items-center justify-between gap-2 font-mono text-[11px]">
      <span className="min-w-0 truncate">{body}</span>
      {canReset && (
        <button
          type="button"
          onClick={onReset}
          className="hover:text-foreground shrink-0 underline-offset-2 hover:underline"
        >
          reset to default
        </button>
      )}
    </p>
  )
}

/** Lower-case slug suitable for a single DNS label. Strips anything
 *  outside [a-z0-9-], collapses runs of hyphens, trims leading/trailing
 *  hyphens, and caps at the 30-char per-label limit the server enforces. */
function dnsLabelSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)
    .replace(/-$/, "")
}

/** Client-side mirror of the server hostname regex (without the fixed
 *  `.vpn.local` suffix). Used for instant feedback before the debounced
 *  /dns-check request fires. */
function isValidDnsPrefix(prefix: string): boolean {
  if (!prefix) return false
  const labelRe = /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/
  return prefix.split(".").every((p) => labelRe.test(p))
}

/** Selectable card for the IP allocation mode. Two of these sit side-by-side
 *  — the selected one gets a primary-tinted border + filled radio dot so the
 *  active choice is obvious at a glance. */
function IpModeOption({
  selected,
  onClick,
  title,
  sub,
}: {
  selected: boolean
  onClick: () => void
  title: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        "border-border flex flex-col items-start gap-1 border p-3 text-left transition",
        selected
          ? "border-primary bg-primary/5"
          : "hover:border-foreground/40",
      ].join(" ")}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span
          className={[
            "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-primary" : "border-border",
          ].join(" ")}
          aria-hidden
        >
          {selected && <span className="bg-primary block size-1.5 rounded-full" />}
        </span>
        {title}
      </span>
      <span className="text-muted-foreground font-mono text-[11px] leading-snug">
        {sub}
      </span>
    </button>
  )
}

function downloadConfig(name: string, config: string) {
  const safe = name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "zerovpn"
  const blob = new Blob([config], { type: "text/plain" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${safe}.conf`
  a.click()
  URL.revokeObjectURL(url)
}

function formatRate(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(1)} kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return "never"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "now"
  return fmtRel(ms)
}

/** Build a plausible example IP for the input placeholder, based on the
 *  server's CIDR. We just swap the host portion for `.42` so the user
 *  sees the right network prefix without us pretending to allocate. */
function ipPlaceholderFor(cidr: string): string {
  const range = ipRangeFromCidr(cidr)
  if (!range) return "10.42.0.42"
  // Use the network's third octet but force the host portion to .42 when
  // the subnet is /24 or larger; for smaller subnets just hand back the
  // first usable address as a safe example.
  const slash = cidr.indexOf("/")
  const prefix = slash > 0 ? parseInt(cidr.slice(slash + 1), 10) : 32
  if (prefix <= 24) {
    const parts = range.first.split(".")
    return `${parts[0]}.${parts[1]}.${parts[2]}.42`
  }
  return range.first
}

/** Return a human-readable reason why `ip` cannot be allocated inside
 *  `cidr`, or null if the address is fine. Caller is responsible for
 *  already having validated that `ip` parses as IPv4. */
function ipOutsideCidrReason(ip: string, cidr: string): string | null {
  const slash = cidr.indexOf("/")
  if (slash < 0) return null
  const net = cidr.slice(0, slash)
  const prefix = parseInt(cidr.slice(slash + 1), 10)
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null
  const netParts = net.split(".").map(Number)
  const ipParts = ip.split(".").map(Number)
  if (netParts.length !== 4 || ipParts.length !== 4) return null
  const netU32 =
    ((netParts[0] << 24) | (netParts[1] << 16) | (netParts[2] << 8) | netParts[3]) >>> 0
  const ipU32 =
    ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0
  const total = 2 ** (32 - prefix)
  const mask = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0
  const baseU32 = (netU32 & mask) >>> 0
  const broadcastU32 = (baseU32 + total - 1) >>> 0
  if (ipU32 < baseU32 || ipU32 > broadcastU32) {
    return `outside ${cidr}`
  }
  if (total >= 4) {
    if (ipU32 === baseU32) return "network address (reserved)"
    if (ipU32 === broadcastU32) return "broadcast address (reserved)"
    if (ipU32 === ((baseU32 + 1) >>> 0)) return "gateway address (reserved)"
  }
  return null
}

/** Compute the usable IPv4 address range for a CIDR — i.e. excluding the
 *  network address, the gateway slot (.1, which the server reserves), and
 *  the broadcast address. Returns null for malformed input or subnets too
 *  small to host anything (≤ /30). */
export function ipRangeFromCidr(cidr: string): {
  first: string
  last: string
  total: number
} | null {
  const slash = cidr.indexOf("/")
  if (slash < 0) return null
  const net = cidr.slice(0, slash)
  const prefix = parseInt(cidr.slice(slash + 1), 10)
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null
  const parts = net.split(".").map(Number)
  if (parts.length !== 4) return null
  if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null
  const base =
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  const total = 2 ** (32 - prefix)
  if (total < 4) return null // /31, /32 don't have a usable peer range
  // .0 = network, .1 = gateway (server), .N-1 = broadcast — all reserved.
  const firstU32 = (base + 2) >>> 0
  const lastU32 = (base + total - 2) >>> 0
  const u32ToIp = (n: number) =>
    `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`
  return { first: u32ToIp(firstU32), last: u32ToIp(lastU32), total: total - 3 }
}
