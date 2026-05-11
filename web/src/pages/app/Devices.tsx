import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconCheck,
  IconChevronDown,
  IconDeviceTablet,
  IconDownload,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconQrcode,
  IconSearch,
  IconX,
} from "@tabler/icons-react"
import { AnimatePresence, motion } from "motion/react"
import { Link } from "react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CopyableCode } from "@/components/CopyableCode"
import { EmptyState } from "@/components/EmptyState"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
  type PublicDevice,
  createDevice,
  deleteDevice,
  listDevices,
  meServer,
  pauseDevice,
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

export function DevicesPage() {
  const qc = useQueryClient()
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })

  // Two orthogonal multi-select dimensions: connection (is the tunnel
  // up right now?) and peer (admin lifecycle). Empty set = no constraint
  // on that dimension — same behaviour as picking every option.
  const [connFilter, setConnFilter] = useState<Set<ConnState>>(new Set())
  const [peerFilter, setPeerFilter] = useState<Set<PeerState>>(new Set())
  const [query, setQuery] = useState("")
  const [created, setCreated] = useState<CreatedDevice | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [revokeId, setRevokeId] = useState<string | null>(null)

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
      void qc.invalidateQueries({ queryKey: ["devices"] })
      toast.info("Device paused")
    },
  })
  const unpauseM = useMutation({
    mutationFn: (id: string) => unpauseDevice(id),
    onSuccess: () => {
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

  const onlinePct =
    devices.length === 0
      ? 0
      : Math.round((counts.online / devices.length) * 100)

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

  // Top-3 ranked by current rate — limited to currently-online devices
  // so we never headline a stale sample from something that's offline.
  const topTraffic = useMemo(() => {
    const ranked = filtered
      .filter(({ c }) => c === "online")
      .map(({ d, c }) => {
        const r = rates.get(d.id) ?? { rxBps: 0, txBps: 0 }
        return { device: d, conn: c, total: r.rxBps + r.txBps, rxBps: r.rxBps, txBps: r.txBps }
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
    const peak = ranked[0]?.total ?? 0
    return { rows: ranked, peak }
  }, [filtered, rates])

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Workspace · 02"
        title="Devices"
        sub={`${devices.length} total · ${counts.online} online`}
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
                setCreated(d)
                setAddOpen(false)
              }}
            />
          </Dialog>
        }
      />

      <FleetSummary
        devices={devices}
        filteredCount={filtered.length}
        counts={counts}
        onlinePct={onlinePct}
        totalRxBps={filteredTotalRxBps}
        totalTxBps={filteredTotalTxBps}
        rxHistory={filteredRxHistory}
        txHistory={filteredTxHistory}
        topTraffic={topTraffic}
        loading={devicesQ.isLoading}
      />

      <AnimatePresence>
        {created && (
          <CreatedDeviceCard data={created} onClose={() => setCreated(null)} />
        )}
      </AnimatePresence>

      <Panel
        flush
        right={
          <>
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
        {filtered.length > 0 && (
          <table className="zv-table">
            <thead>
              <tr>
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
                return (
                  <tr key={d.id}>
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
                        onPause={() => pauseM.mutate(d.id)}
                        onUnpause={() => unpauseM.mutate(d.id)}
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
      </Panel>

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
    </div>
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
  onlinePct,
  totalRxBps,
  totalTxBps,
  rxHistory,
  txHistory,
  topTraffic,
  loading,
}: {
  devices: PublicDevice[]
  filteredCount: number
  counts: { online: number; offline: number; live: number; paused: number; revoked: number }
  onlinePct: number
  totalRxBps: number
  totalTxBps: number
  rxHistory: number[]
  txHistory: number[]
  topTraffic: {
    rows: {
      device: PublicDevice
      conn: ConnState
      total: number
      rxBps: number
      txBps: number
    }[]
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
          <FleetOnlineBar pct={onlinePct} />
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

        {/* ── Section 3 · Top traffic ─────────────────────────────────── */}
        <div className="flex flex-col gap-3 p-5">
          <SectionHeader
            num="03"
            label="Top traffic"
            hint={topTraffic.rows.length > 0 ? "by current rate" : undefined}
          />
          {topTraffic.rows.length === 0 ? (
            <p className="text-muted-foreground/70 font-mono text-[11px]">
              {counts.online === 0
                ? "no online devices in the current filter"
                : "no transmitting devices right now"}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {topTraffic.rows.map((row, i) => (
                <TopTrafficRow
                  key={row.device.id}
                  rank={i + 1}
                  name={row.device.name}
                  ip={row.device.allocated_ip}
                  conn={row.conn}
                  total={row.total}
                  peak={topTraffic.peak}
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

/** Compact left-aligned progress bar — same hairline tone as the rest
 *  of the Swiss kit, no rounded corners. */
function FleetOnlineBar({ pct }: { pct: number }) {
  return (
    <div className="mt-auto flex items-center gap-2 pt-1">
      <div className="border-border relative h-1.5 flex-1 border bg-card">
        <div
          className="bg-status-online absolute inset-y-0 left-0"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
        {pct}%
      </span>
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

function TopTrafficRow({
  rank,
  name,
  ip,
  conn,
  total,
  peak,
}: {
  rank: number
  name: string
  ip: string
  conn: ConnState
  total: number
  peak: number
}) {
  const pct = peak > 0 ? Math.max(6, (total / peak) * 100) : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground/70 w-3 shrink-0 text-right tabular-nums">
            {rank}
          </span>
          <StatusPill status={conn === "online" ? "online" : "offline"} dotOnly />
          <span className="text-foreground truncate font-medium">{name}</span>
        </span>
        <span className="text-foreground tabular-nums">{formatRate(total)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="border-border relative h-1 flex-1 border bg-card">
          <div
            className="bg-primary absolute inset-y-0 left-0"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-muted-foreground/70 w-[88px] shrink-0 text-right font-mono text-[10px] tabular-nums">
          {ip}
        </span>
      </div>
    </div>
  )
}

/** Multi-select dropdown filter. The trigger is a chip showing the
 *  dimension's label, the number of selected options (or "all"), and a
 *  caret. The popover content is a small checkbox list — clicking a row
 *  toggles selection without closing, matching how Linear / Notion / etc.
 *  handle multi-select filter chips. */
function FilterDropdown<T extends string>({
  label,
  options,
  selected,
  onToggle,
  onClear,
  counts,
}: {
  label: string
  options: { value: T; label: string; pill: PillStatus }[]
  selected: Set<T>
  onToggle: (v: T) => void
  onClear: () => void
  counts: Record<string, number>
}) {
  const selectedLabels = options
    .filter((o) => selected.has(o.value))
    .map((o) => o.label)
  const summary =
    selected.size === 0
      ? "All"
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selected.size} selected`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          className={[
            "zv-filter-dd",
            selected.size > 0 && "zv-filter-dd--on",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="zv-filter-dd__label">{label}</span>
          <span className="zv-filter-dd__value">{summary}</span>
          {selected.size > 0 && (
            <span className="zv-filter-dd__badge">{selected.size}</span>
          )}
          <IconChevronDown
            size={12}
            className="text-muted-foreground"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0 font-mono text-xs">
        <div className="text-muted-foreground flex items-center justify-between border-b px-3 py-2">
          <span className="zv-eyebrow text-[10px]">{label}</span>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="hover:text-foreground"
            >
              clear
            </button>
          )}
        </div>
        <ul role="listbox" aria-multiselectable="true" className="py-1">
          {options.map((opt) => {
            const isOn = selected.has(opt.value)
            return (
              <li key={opt.value} role="option" aria-selected={isOn}>
                <button
                  type="button"
                  onClick={() => onToggle(opt.value)}
                  className="hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-1.5 text-left"
                >
                  <span
                    className={[
                      "zv-filter-dd__check",
                      isOn && "zv-filter-dd__check--on",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-hidden
                  >
                    {isOn && <IconCheck size={10} strokeWidth={3} />}
                  </span>
                  <StatusPill status={opt.pill} dotOnly />
                  <span className="flex-1">{opt.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {counts[opt.value] ?? 0}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
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
  const downloadDisabled = device.status === "revoked"
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
      <Link
        to={`/app/devices/${device.id}`}
        className="zv-icon-btn"
        title="View config"
        aria-disabled={downloadDisabled}
        onClick={(e) => downloadDisabled && e.preventDefault()}
      >
        <IconDownload size={12} />
      </Link>
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
  const [result, setResult] = useState<CreatedDevice | null>(null)

  const dnsLooksValid = useMemo(() => {
    if (!dnsInput.trim()) return true
    const parts = dnsInput.split(",").map((s) => s.trim()).filter(Boolean)
    return parts.every((p) => /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/.test(p))
  }, [dnsInput])

  const ipLooksValid = useMemo(() => {
    if (ipMode === "auto") return true
    const v = ipInput.trim()
    if (!v) return false
    return /^(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})$/.test(v)
  }, [ipMode, ipInput])

  const addM = useMutation({
    mutationFn: () => {
      const dns = dnsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      return createDevice({
        name: name.trim(),
        os: osChoice,
        split_tunnel: splitTunnel || undefined,
        dns_override: dns.length > 0 ? dns : undefined,
        allocated_ip:
          ipMode === "custom" && ipInput.trim() ? ipInput.trim() : undefined,
      })
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
    dnsLooksValid &&
    ipLooksValid &&
    !addM.isPending

  const resetAll = () => {
    setStep(1)
    setName("")
    setOsChoice("other")
    setSplitTunnel(false)
    setDnsInput("")
    setIpMode("auto")
    setIpInput("")
    setResult(null)
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
            />
            <p className="text-muted-foreground font-mono text-[11px]">
              1–64 chars. Used as the WireGuard interface name on the device.
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
                  {!ipLooksValid && ipInput && (
                    <span className="text-destructive ml-2">
                      that doesn't look like a valid IPv4 address
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

function CreatedDeviceCard({
  data,
  onClose,
}: {
  data: CreatedDevice
  onClose: () => void
}) {
  return (
    <motion.div
      key={data.device.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
    >
      <Panel
        title={`${data.device.name} · ready`}
        sub="Save this config now — the private key isn't stored on the server."
        className="border-status-online/40 bg-status-online/5"
      >
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="zv-qr-box bg-card flex shrink-0 items-center justify-center">
            <span
              className="block size-32"
              dangerouslySetInnerHTML={{ __html: data.qr_svg }}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-sm">
              Allocated IP:{" "}
              <span className="zv-kbd">{data.device.allocated_ip}</span>
            </p>
            <CopyableCode value={data.config} multiline />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => downloadConfig(data.device.name, data.config)}
          >
            <IconDownload />
            Download .conf
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </Panel>
    </motion.div>
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
