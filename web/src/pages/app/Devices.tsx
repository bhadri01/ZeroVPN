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
import { motion, Reorder, useDragControls } from "motion/react"
import { Link, useNavigate } from "react-router"
import { useEffect, useMemo, useRef, useState } from "react"
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
import { EmptyState } from "@/components/EmptyState"
import { FilterDropdown } from "@/components/FilterDropdown"
import { PageStagger, StaggerItem } from "@/components/motion"
import { fmtRel, PageHead, Panel, Pill } from "@/components/swiss"
import { StatusPill, type Status as PillStatus } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { WithTooltip } from "@/components/ui/with-tooltip"
import { Sheet, SheetTrigger } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import {
  type PublicDevice,
  deleteDevice,
  listDevices,
  pauseDevice,
  reorderDevices,
  unpauseDevice,
} from "@/lib/api"
import {
  connState,
  endpointHost,
  peerState,
  type ConnState,
  type PeerState,
} from "@/lib/deviceState"
import { compactBytes } from "@/lib/units"
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

  // Drag state. Two different drag mechanisms in play:
  //
  // LIST view  — uses motion's `<Reorder>` (1D, perfect fit). The
  //   `localOrder` mirror is updated continuously via `onReorder` while
  //   the user drags, so siblings smoothly slide up/down via FLIP.
  //   Commit happens on release in `handleDragRelease`.
  //
  // GRID view  — uses plain `motion.div` per card with custom drop
  //   detection. Reorder.Group's 1D model on a 2D CSS grid produced a
  //   cascade where every card in the row drifted whenever the dragged
  //   card's array index changed. The fix: don't touch the values
  //   array during drag. The dragged card transforms freely to follow
  //   the cursor, its grid slot stays visually empty (because the
  //   element transformed away), siblings hold position. `dropIndex`
  //   tracks which card is currently under the cursor for the highlight
  //   + commit target. Commit fires on release via `commitGridDrop`.
  const [localOrder, setLocalOrder] = useState<PublicDevice[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  // Refs to each grid card's outer element. Drop detection iterates
  // these and tests cursor against bounding rects. Cleared on unmount
  // via the ref callback's `null` path.
  const gridCardRefs = useRef<Map<string, HTMLElement>>(new Map())
  // Tile the cursor was last inside during a grid drag. Used to avoid
  // re-firing the reorder every animation frame — only when the cursor
  // crosses into a *different* tile do we splice the array.
  const gridHoverRef = useRef<string | null>(null)

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
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  const togglePeer = (v: PeerState) =>
    setPeerFilter((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  const clearFilters = () => {
    setConnFilter(new Set())
    setPeerFilter(new Set())
  }

  /** In-flight grid reorder. Fires on every motion `onDrag` frame —
   *  if the cursor has crossed into a *different* sibling tile since
   *  the last frame, splice the source into that tile's slot and
   *  update `localOrder` so motion's layout animation slides siblings
   *  out of the way (the same FLIP-driven feel the list view gets
   *  from `Reorder.Item`).
   *
   *  This is the grid analogue of motion's built-in `Reorder.Group`,
   *  but with 2D hit-testing: motion's Reorder is 1D and would never
   *  fire on a pure-horizontal drag. Doing the splice mid-drag (not
   *  on release) is what makes the drop *feel* right — by the time
   *  the user lets go, the array is already in its target shape, so
   *  release just snaps the drag transform to zero.
   *
   *  Commit (persistence) still happens on release via
   *  `handleDragRelease`, exactly like the list view. */
  const gridInflightReorder = (
    sourceId: string,
    point: { x: number; y: number },
  ) => {
    // Which sibling's bounding box is the cursor currently inside?
    // Using a strict point-in-rect test (rather than "closest centre")
    // means we only swap when the user has clearly dragged onto a tile
    // — drags in the gutter leave the order alone, no jitter.
    let hovered: string | null = null
    for (const [id, el] of gridCardRefs.current) {
      if (id === sourceId) continue
      const r = el.getBoundingClientRect()
      if (
        point.x >= r.left &&
        point.x <= r.right &&
        point.y >= r.top &&
        point.y <= r.bottom
      ) {
        hovered = id
        break
      }
    }
    if (hovered === gridHoverRef.current) return
    gridHoverRef.current = hovered
    if (!hovered) return

    const visible = filtered.map((row) => row.d)
    const sourceIdx = visible.findIndex((d) => d.id === sourceId)
    const targetIdx = visible.findIndex((d) => d.id === hovered)
    if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return

    // Shift-insert: source takes target's slot, target + tail shift by
    // one. Dragging forward, the removed source pulls the target's
    // index down by one in the modified array.
    const newVisible = [...visible]
    const [moved] = newVisible.splice(sourceIdx, 1)
    const insertAt = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx
    newVisible.splice(insertAt, 0, moved)
    onReorderFiltered(newVisible)
  }

  return (
    <PageStagger>
      <StaggerItem>
      <PageHead
        eyebrow="Workspace · 02"
        title="Devices"
        right={
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger asChild>
              <Button className="max-sm:w-full">
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
      <Panel
        flush
        title={
          devicesQ.data ? (
            <Pill tone="neutral" dot={false}>
              {visibleRows.length === devices.length
                ? `${devices.length} ${devices.length === 1 ? "device" : "devices"}`
                : `${visibleRows.length} of ${devices.length}`}
            </Pill>
          ) : undefined
        }
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
            <div className="relative max-sm:w-full">
              <IconSearch
                size={12}
                className="text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="h-7 w-full pl-6 font-mono text-xs sm:w-48"
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
              <div className="zv-cell">VPN IP</div>
              <div className="zv-cell">Via</div>
              <div className="zv-cell">Status</div>
              <div className="zv-cell">Activity</div>
              <div className="zv-cell zv-num">Total TX</div>
              <div className="zv-cell zv-num">Total RX</div>
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
                // Cumulative totals — same gate the card uses: a device
                // that's never handshook reads zero regardless of any
                // stale counters the worker may have produced.
                const hasEverHandshook = d.last_handshake_at != null
                const totalRx = hasEverHandshook ? (liveEntry?.totalRx ?? 0) : 0
                const totalTx = hasEverHandshook ? (liveEntry?.totalTx ?? 0) : 0
                const rowStatus = rowPill(c, p)
                return (
                  <SortableListRow
                    key={d.id}
                    device={d}
                    rowStatus={rowStatus}
                    connState={c}
                    peerState={p}
                    rxHistory={rowRx}
                    txHistory={rowTx}
                    totalRx={totalRx}
                    totalTx={totalTx}
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
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleRows.map(({ d }) => (
              <GridDragCard
                key={d.id}
                device={d}
                isDragging={dragId === d.id}
                onDragStart={() => {
                  setDragId(d.id)
                  gridHoverRef.current = null
                }}
                onDragInflight={(point) => gridInflightReorder(d.id, point)}
                onDragEnd={() => {
                  gridHoverRef.current = null
                  handleDragRelease()
                }}
                onDoubleClick={() => navigate(`/app/devices/${d.id}`)}
                registerRef={(el) => {
                  if (el) gridCardRefs.current.set(d.id, el)
                  else gridCardRefs.current.delete(d.id)
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
            ))}
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
  rxHistory,
  txHistory,
  totalRx,
  totalTx,
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
  rxHistory: number[]
  txHistory: number[]
  totalRx: number
  totalTx: number
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDoubleClick: () => void
  actions: React.ReactNode
}) {
  const peerHost = d.last_peer_endpoint
    ? endpointHost(d.last_peer_endpoint)
    : null
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
      <div className="zv-cell font-mono">{d.allocated_ip}</div>
      <div
        className="zv-cell text-muted-foreground truncate font-mono"
        title={peerHost ?? "No endpoint observed yet"}
      >
        {peerHost ?? "—"}
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
        {d.last_handshake_at != null ? (
          compactBytes(totalTx)
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </div>
      <div className="zv-cell zv-num">
        {d.last_handshake_at != null ? (
          compactBytes(totalRx)
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
 * Grid-view card. Uses a plain `motion.div` (not `Reorder.Item`) so
 * the user can drag freely in 2D. Motion's `Reorder` is 1D and would
 * never reorder on a pure-horizontal drag.
 *
 * The flow mirrors what `Reorder.Item` does internally, but with
 * 2D hit-testing instead of 1D axis comparison:
 *   1. Pointer-down on the grip arms motion's drag via `dragControls`.
 *   2. `drag` lets the card translate freely in both axes.
 *   3. On every drag frame, `onDragInflight` reports the cursor point
 *      to the parent, which re-splices the array as the cursor crosses
 *      into a different sibling's bounding box. Motion's `layout` then
 *      slides siblings out of the way via FLIP.
 *   4. On release, `dragSnapToOrigin` snaps the drag transform back to
 *      0 — by that point the array is already in its final shape, so
 *      the card lands cleanly in its new slot with no double animation.
 *
 * `registerRef` hands the DOM node up to the parent so it can iterate
 * every card's bounding rect during drop targeting.
 */
function GridDragCard({
  device: d,
  isDragging,
  onDragStart,
  onDragInflight,
  onDragEnd,
  onDoubleClick,
  registerRef,
  actions,
}: {
  device: PublicDevice
  isDragging: boolean
  onDragStart: () => void
  onDragInflight: (point: { x: number; y: number }) => void
  onDragEnd: () => void
  onDoubleClick: () => void
  registerRef: (el: HTMLDivElement | null) => void
  actions: React.ReactNode
}) {
  const controls = useDragControls()
  return (
    <motion.div
      ref={registerRef}
      layout
      drag
      dragSnapToOrigin
      dragMomentum={false}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDrag={(_, info) => onDragInflight(info.point)}
      onDragEnd={onDragEnd}
      onDoubleClick={onDoubleClick}
      className="flex"
      data-grid-tile={d.id}
      style={isDragging ? { zIndex: 2 } : undefined}
    >
      <DeviceCard
        device={d}
        className="w-full"
        data-dragging={isDragging ? "1" : undefined}
        dragHandleProps={{
          onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
            controls.start(e)
          },
        }}
        actions={actions}
      />
    </motion.div>
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

function formatLastSeen(iso: string | null): string {
  if (!iso) return "never"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "now"
  return fmtRel(ms)
}
