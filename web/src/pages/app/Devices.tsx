import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconDeviceTablet,
  IconDotsVertical,
  IconGripVertical,
  IconLayoutGrid,
  IconLayoutList,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { Reorder, useDragControls } from "motion/react"
import { Link, useNavigate } from "react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { MiniAreaChart } from "@/components/charts/LazyMiniAreaChart"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { DeviceCard } from "@/components/DeviceCard"
import { AddDeviceDialog } from "@/components/devices/AddDeviceDialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DevicesLoadingSkeleton,
  type ViewMode,
} from "@/components/devices/DevicesLoadingSkeleton"
import { FleetSummary } from "@/components/devices/FleetSummary"
import { sumHistoriesRightAligned } from "@/components/devices/helpers"
import { EmptyState } from "@/components/EmptyState"
import { FilterDropdown } from "@/components/FilterDropdown"
import { PageStagger, StaggerItem } from "@/components/motion"
import { fmtRel, PageHead, Panel } from "@/components/swiss"
import { StatusPill, type Status as PillStatus } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { WithTooltip } from "@/components/ui/with-tooltip"
import { Sheet, SheetTrigger } from "@/components/ui/sheet"
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

/** Frames of live history rendered in each list-row sparkline. Matches
 *  the grid view's DeviceCard so the two layouts feel related — long
 *  enough to show shape, short enough that the Y axis isn't pulled by
 *  an hour-old peak. The live store retains up to 1800 frames (30 min
 *  at 1 Hz) so this is purely a render-side cap. */
const LIST_CHART_WINDOW = 30

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

// "Revoked" intentionally omitted — revoking a device removes it from
// the list, so the filter would never match anything. Keep the two
// peer states the user can actually observe in the list.
const PEER_FILTERS: { value: PeerState; label: string; pill: PillStatus }[] = [
  { value: "live", label: "Live", pill: "online" },
  { value: "paused", label: "Paused", pill: "paused" },
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

  // Drag state: `localOrder` is the in-flight ordering while the user
  // is dragging — Reorder.Group fires onReorder repeatedly with the
  // new array; we mirror it here so the visible rows/cards re-render
  // smoothly (each Reorder.Item handles the FLIP animation
  // automatically). `dragId` is just the visual flag for the source
  // row's "I'm being dragged" styling.
  //
  // The previous HTML5-drag + motion.layout pairing wasn't reliable
  // (table rows don't play nicely with transform-based animations,
  // and CSS-grid auto-flow can miss reorder events). motion's
  // `<Reorder>` is purpose-built for this — pointer-event driven,
  // built-in spring animations, single source of truth for order.
  const [localOrder, setLocalOrder] = useState<PublicDevice[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const devices = devicesQ.data ?? []

  /** When the user reorders the *filtered* list, splice the new order
   *  back into the full device array — keeping any filtered-out items
   *  pinned in their original slots. That way reorder-while-filtered
   *  still does the obvious thing for the user (the two visible items
   *  swap relative positions in the persistent list) without
   *  disrupting the ordering of items that aren't on screen. */
  const onReorderFiltered = (nextFiltered: PublicDevice[]) => {
    const base = localOrder ?? devices
    const visibleIds = new Set(nextFiltered.map((d) => d.id))
    const merged: PublicDevice[] = []
    let visibleIdx = 0
    for (const item of base) {
      if (visibleIds.has(item.id)) {
        merged.push(nextFiltered[visibleIdx++])
      } else {
        merged.push(item)
      }
    }
    setLocalOrder(merged)
  }

  /** Pointer release — commit if the order changed, otherwise clear. */
  const handleDragRelease = () => {
    const next = localOrder
    setLocalOrder(null)
    setDragId(null)
    if (!next) return
    const before = devices.map((d) => d.id)
    const after = next.map((d) => d.id)
    if (
      after.length === before.length &&
      after.every((id, i) => id === before[i])
    ) {
      return
    }
    reorderM.mutate(after)
  }

  // Derive both axes once and cache so the table cells and filter counts
  // agree without recomputing per render. `effectiveDevices` honours the
  // in-flight Reorder ordering so the rendered list reflects the user's
  // drag in real time without disturbing the React Query cache (which
  // we only mutate on commit).
  const effectiveDevices = localOrder ?? devices
  const decorated = useMemo(
    () => effectiveDevices.map((d) => ({ d, c: connState(d), p: peerState(d) })),
    [effectiveDevices],
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

  // `filtered` is already in `localOrder` order during drag (via
  // `effectiveDevices` above), so it doubles as the render list.
  const visibleRows = filtered

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

  // (drop commit now happens in `handleDragRelease` above — fires when
  // each Reorder.Item's pointer drag ends. No more HTML5-drag glue.)

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
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger asChild>
              <Button>
                <IconPlus />
                Add device
              </Button>
            </SheetTrigger>
            <AddDeviceDialog
              onCreated={(d) => {
                // Sheet showed QR + config on step 2; on Done we close it
                // and land the user on the new device's detail page so they
                // can verify the row is live without hunting for it.
                setAddOpen(false)
                navigate(`/app/devices/${d.device.id}`)
              }}
            />
          </Sheet>
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
        {devicesQ.data && devicesQ.data.length > 0 && visibleRows.length === 0 && (
          <p className="text-muted-foreground p-4 font-mono text-sm">
            No devices match the current filter.
          </p>
        )}
        {visibleRows.length > 0 && viewMode === "list" && (
          <div className="zv-list-scroll">
          <div className="zv-list">
            <div className="zv-list-row zv-list-head">
              <div className="zv-cell" aria-hidden />
              <div className="zv-cell">Name</div>
              <div className="zv-cell">OS</div>
              <div className="zv-cell">VPN IP</div>
              <div className="zv-cell">Allowed IPs</div>
              <div className="zv-cell">DNS</div>
              <div className="zv-cell">Status</div>
              <div className="zv-cell">Activity</div>
              <div className="zv-cell zv-num">TX</div>
              <div className="zv-cell zv-num">RX</div>
              <div className="zv-cell">Last seen</div>
              <div className="zv-cell zv-cell-sticky-right" aria-hidden />
            </div>
            <Reorder.Group
              as="div"
              axis="y"
              values={visibleRows.map((r) => r.d)}
              onReorder={onReorderFiltered}
              className="zv-list-body"
              layoutScroll
            >
              {visibleRows.map(({ d, c, p }) => {
                const live = rates.get(d.id) ?? { rxBps: 0, txBps: 0 }
                // Tail of the live history for the row's sparkline. Same
                // online-gate logic as DeviceCard: a device that hasn't
                // handshook (or just dropped offline) gets empty arrays
                // so the chart doesn't paint stale data.
                const liveEntry = liveDevices[d.id]
                const isOnlineForChart =
                  d.last_handshake_at != null && c === "online"
                const rowRx = isOnlineForChart
                  ? (liveEntry?.rxHistory ?? []).slice(-LIST_CHART_WINDOW)
                  : []
                const rowTx = isOnlineForChart
                  ? (liveEntry?.txHistory ?? []).slice(-LIST_CHART_WINDOW)
                  : []
                const isSplit =
                  d.allowed_ips_override !== null &&
                  d.allowed_ips_override !== undefined &&
                  d.allowed_ips_override.length > 0
                const dnsDisplay =
                  d.dns_override && d.dns_override.length > 0
                    ? d.dns_override.join(", ")
                    : "server default"
                const rowStatus = rowPill(c, p)
                return (
                  <SortableListRow
                    key={d.id}
                    device={d}
                    rowStatus={rowStatus}
                    connState={c}
                    peerState={p}
                    isSplit={isSplit}
                    dnsDisplay={dnsDisplay}
                    rxHistory={rowRx}
                    txHistory={rowTx}
                    live={live}
                    isDragging={dragId === d.id}
                    onDragStart={() => setDragId(d.id)}
                    onDragEnd={handleDragRelease}
                    onDoubleClick={() => navigate(`/app/devices/${d.id}`)}
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
            </Reorder.Group>
          </div>
          </div>
        )}
        {visibleRows.length > 0 && viewMode === "grid" && (
          <Reorder.Group
            as="div"
            axis="y"
            values={visibleRows.map((r) => r.d)}
            onReorder={onReorderFiltered}
            className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            layoutScroll
          >
            {visibleRows.map(({ d }) => (
              <SortableGridCard
                key={d.id}
                device={d}
                isDragging={dragId === d.id}
                onDragStart={() => setDragId(d.id)}
                onDragEnd={handleDragRelease}
                onDoubleClick={() => navigate(`/app/devices/${d.id}`)}
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
            ))}
          </Reorder.Group>
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

/**
 * One row in the list view, rendered as a `Reorder.Item` so the user
 * can drag it to reorder. Drag is initiated only from the grip handle
 * (via `useDragControls` + `dragListener={false}`) so clicking
 * elsewhere on the row continues to work for navigation. Motion
 * animates siblings out of the way as the pointer moves; release fires
 * `onDragEnd` to commit.
 */
function SortableListRow({
  device: d,
  rowStatus,
  connState: c,
  peerState: p,
  isSplit,
  dnsDisplay,
  rxHistory,
  txHistory,
  live,
  isDragging,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  actions,
}: {
  device: PublicDevice
  rowStatus: PillStatus
  connState: ConnState
  peerState: PeerState
  isSplit: boolean
  dnsDisplay: string
  rxHistory: number[]
  txHistory: number[]
  live: { rxBps: number; txBps: number }
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDoubleClick: () => void
  actions: React.ReactNode
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={d}
      as="div"
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={onDoubleClick}
      data-dragging={isDragging ? "1" : undefined}
      className="zv-list-row"
      // While being dragged, lift the row above its siblings so the
      // shadow + border highlight aren't clipped under the next row.
      style={isDragging ? { zIndex: 2 } : undefined}
    >
      <div
        className="zv-drag-cell"
        // Pointer-down on the grip arms motion's drag controls. From
        // here on, motion handles pointer-move / pointer-up internally
        // — we just get the start/end callbacks via Reorder.Item.
        onPointerDown={(e) => controls.start(e)}
        title="Drag to reorder"
      >
        <IconGripVertical size={14} />
      </div>
      <div className="zv-cell">
        <Link
          to={`/app/devices/${d.id}`}
          className="hover:text-foreground inline-flex items-center gap-2 font-medium"
        >
          <StatusPill status={rowStatus} dotOnly />
          {d.name}
        </Link>
      </div>
      <div className="zv-cell text-muted-foreground">{d.os}</div>
      <div className="zv-cell font-mono">{d.allocated_ip}</div>
      <div
        className="zv-cell text-muted-foreground truncate font-mono"
        title={isSplit ? d.allowed_ips_override!.join(", ") : "0.0.0.0/0, ::/0"}
      >
        {isSplit ? d.allowed_ips_override!.join(", ") : "0.0.0.0/0, ::/0"}
      </div>
      <div
        className="zv-cell text-muted-foreground truncate font-mono"
        title={dnsDisplay}
      >
        {dnsDisplay}
      </div>
      <div className="zv-cell">
        <div className="inline-flex items-center gap-1.5">
          <StatusPill status={c} />
          {p !== "live" && (
            <StatusPill status={p === "paused" ? "paused" : "revoked"} />
          )}
        </div>
      </div>
      <div className="zv-cell" style={{ padding: "4px 12px" }}>
        <div className="w-[116px]">
          <MiniAreaChart
            rxHistory={rxHistory}
            txHistory={txHistory}
            height={28}
          />
        </div>
      </div>
      <div className="zv-cell zv-num">
        {c === "online" ? (
          formatRate(live.txBps)
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </div>
      <div className="zv-cell zv-num">
        {c === "online" ? (
          formatRate(live.rxBps)
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </div>
      <div className="zv-cell text-muted-foreground font-mono text-xs">
        {formatLastSeen(d.last_handshake_at)}
      </div>
      <div className="zv-cell zv-cell-sticky-right">{actions}</div>
    </Reorder.Item>
  )
}

/**
 * Grid-view card wrapped in a `Reorder.Item` with the same controls-
 * via-grip pattern as the list row.
 *
 * Earlier iterations of this component layered extras on top
 * (`drag` for 2D movement, custom spring transition, `whileDrag` scale,
 * `dragElastic`, `dragMomentum={false}`). Each one seemed reasonable in
 * isolation but they collectively fought motion's built-in layout
 * animations — `whileDrag.scale` resizes the dragged element's bounding
 * box every frame, which throws off the FLIP measurements siblings use
 * to slide into the freed slot, producing the choppy "jumps instead of
 * glides" the user reported. The list view doesn't add any of those
 * and animates smoothly; mirroring its config does the same for the
 * grid.
 *
 * Trade-off: the card slides along the group's `axis="y"` only while
 * being dragged (no horizontal cursor-following). Reordering still
 * works because the CSS-grid auto-flow re-places cards as the array
 * shuffles — moving a card down past the row Y-center inserts it into
 * the next row's first slot, etc. Matching list-view smoothness was
 * the right call here.
 */
function SortableGridCard({
  device: d,
  isDragging,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  actions,
}: {
  device: PublicDevice
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDoubleClick: () => void
  actions: React.ReactNode
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={d}
      as="div"
      // Free 2D movement during drag — without this the card is locked
      // to the parent group's axis (y), so it can't follow the cursor
      // horizontally across the grid's columns. The reorder LOGIC still
      // uses the group's Y-axis to decide when to swap items, so the
      // committed order stays sensible — only the in-flight drag is
      // freed up to feel natural.
      drag
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="flex"
      style={isDragging ? { zIndex: 2 } : undefined}
    >
      <DeviceCard
        device={d}
        className="w-full"
        data-dragging={isDragging ? "1" : undefined}
        onDoubleClick={onDoubleClick}
        dragHandleProps={{
          // Pointer-down on the card's grip arms motion's drag controls;
          // dragListener={false} on the Reorder.Item means no other
          // surface initiates a drag.
          onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
            controls.start(e)
          },
        }}
        actions={actions}
      />
    </Reorder.Item>
  )
}

/**
 * Per-device action menu — a single 3-dot trigger that opens a
 * dropdown with the available actions for the device's current
 * status. Replaces the inline pause/revoke icon buttons so the row's
 * action area stays compact (one button wide instead of three) and
 * leaves room for the right-sticky column. Used by both list and grid
 * views via DeviceCard's `actions` slot.
 */
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
  const canPause = device.status === "active"
  const canResume = device.status === "paused"
  const canRevoke = device.status !== "revoked"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Device actions"
          // Stop click bubbling so the row's onDoubleClick doesn't trip
          // when the user single-clicks the kebab.
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground border-border hover:border-foreground inline-flex size-7 items-center justify-center border transition-colors"
        >
          <IconDotsVertical size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {canPause && (
          <DropdownMenuItem onSelect={onPause} disabled={pending}>
            <IconPlayerPause />
            Pause
          </DropdownMenuItem>
        )}
        {canResume && (
          <DropdownMenuItem onSelect={onUnpause} disabled={pending}>
            <IconPlayerPlay />
            Resume
          </DropdownMenuItem>
        )}
        {canRevoke && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={onRevoke}
            disabled={pending}
          >
            <IconTrash />
            Revoke
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
