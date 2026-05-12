import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconDeviceTablet,
  IconGripVertical,
  IconLayoutGrid,
  IconLayoutList,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react"
import { Link, useNavigate } from "react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { DeviceCard } from "@/components/DeviceCard"
import { AddDeviceDialog } from "@/components/devices/AddDeviceDialog"
import {
  DevicesLoadingSkeleton,
  type ViewMode,
} from "@/components/devices/DevicesLoadingSkeleton"
import { FleetSummary } from "@/components/devices/FleetSummary"
import { sumHistoriesRightAligned } from "@/components/devices/helpers"
import { EmptyState } from "@/components/EmptyState"
import { FilterDropdown } from "@/components/FilterDropdown"
import { PageStagger, StaggerItem } from "@/components/motion"
import { fmtRel, IconBtn, PageHead, Panel } from "@/components/swiss"
import { StatusPill, type Status as PillStatus } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { WithTooltip } from "@/components/ui/with-tooltip"
import { Dialog, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  type DeviceOs,
  type PublicDevice,
  deleteDevice,
  listDevices,
  pauseDevice,
  reorderDevices,
  unpauseDevice,
} from "@/lib/api"
import {
  connState,
  peerState,
  type ConnState,
  type PeerState,
} from "@/lib/deviceState"
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
                <WithTooltip label="Clear filter">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setQuery("")}
                    aria-label="Clear filter"
                  >
                    <IconX size={12} />
                  </button>
                </WithTooltip>
              )}
            </div>
          </>
        }
      >
        {devicesQ.isLoading && <DevicesLoadingSkeleton viewMode={viewMode} />}
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
    <WithTooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        data-active={active ? "1" : "0"}
        className="text-muted-foreground hover:text-foreground data-[active=1]:bg-muted/60 data-[active=1]:text-foreground inline-flex w-7 items-center justify-center transition-colors first:border-r first:border-border"
      >
        {children}
      </button>
    </WithTooltip>
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
