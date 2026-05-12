import { useQuery } from "@tanstack/react-query"
import {
  IconArrowDown,
  IconArrowUp,
  IconDeviceDesktop,
  IconExternalLink,
  IconRegex,
  IconSearch,
  IconUserSearch,
  IconX,
} from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { MiniAreaChart } from "@/components/charts/LazyMiniAreaChart"
import { EmptyState } from "@/components/EmptyState"
import { FilterDropdown } from "@/components/FilterDropdown"
import { RelativeTime } from "@/components/RelativeTime"
import { Eyebrow, PageHead, Panel } from "@/components/swiss"
import { StatusPill, type Status as PillStatus } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { type PublicDevice, listDevices } from "@/lib/api"
import {
  connState,
  peerState,
  type ConnState,
  type PeerState,
} from "@/lib/deviceState"
import { compactBytes, formatBps } from "@/lib/units"
import { useLiveStats } from "@/stores/liveStats"

const IPV4_RX = /^(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})$/

const CONN_FILTERS: { value: ConnState; label: string; pill: PillStatus }[] = [
  { value: "online", label: "Online", pill: "online" },
  { value: "offline", label: "Offline", pill: "offline" },
]
const PEER_FILTERS: { value: PeerState; label: string; pill: PillStatus }[] = [
  { value: "live", label: "Live", pill: "online" },
  { value: "paused", label: "Paused", pill: "paused" },
  { value: "revoked", label: "Revoked", pill: "revoked" },
]

/**
 * Peer Finder — look devices up by their assigned IPv4 address or by a
 * regex pattern against the IP. Plus connection + peer-state filter
 * pills so the result set narrows further without re-typing the search.
 *
 * Scope: limited to the current user's own devices (the `listDevices()`
 * endpoint only returns those). Matching is client-side filtering
 * against `allocated_ip`. If we ever add an admin-wide search endpoint,
 * swap the data source — the UI shape doesn't change.
 */
export function FinderPage() {
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
  const [queryInput, setQueryInput] = useState("")
  const [useRegex, setUseRegex] = useState(false)
  // Searches are explicit (Enter / button click) rather than as-you-type
  // so the result grid only flips when the user commits — keeps the
  // interaction predictable when typing a list or a slow regex.
  const [committed, setCommitted] = useState<
    | { kind: "ips"; ips: string[] }
    | { kind: "regex"; source: string }
    | null
  >(null)

  // Filter pills (same axes as the Devices page): connection state and
  // peer state. Empty set = no constraint on that axis.
  const [connFilter, setConnFilter] = useState<Set<ConnState>>(new Set())
  const [peerFilter, setPeerFilter] = useState<Set<PeerState>>(new Set())
  const liveDevices = useLiveStats((s) => s.devices)

  const devices = devicesQ.data ?? []

  // Validate the input on every keystroke so we can disable the button +
  // surface a hint without waiting for submit. Regex mode validates by
  // try/catch on the constructor; non-regex mode parses comma-separated
  // exact IPv4s.
  const parsed = useMemo(() => {
    const raw = queryInput.trim()
    if (raw === "") return { kind: "empty" as const }
    if (useRegex) {
      try {
        // Compile case-insensitive — IPs don't carry case but it's friendly
        // for any future hostname/label search expansions.
        new RegExp(raw, "i")
        return { kind: "regex" as const, source: raw }
      } catch (e) {
        return {
          kind: "invalid-regex" as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }
    const ips = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const invalid = ips.filter((ip) => !IPV4_RX.test(ip))
    return { kind: "ips" as const, ips, invalid }
  }, [queryInput, useRegex])

  const canSubmit =
    (parsed.kind === "ips" && parsed.ips.length > 0 && parsed.invalid.length === 0) ||
    parsed.kind === "regex"

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (parsed.kind === "ips" && parsed.invalid.length > 0) {
      toast.error("One or more entries aren't valid IPv4 addresses")
      return
    }
    if (parsed.kind === "invalid-regex") {
      toast.error("Invalid regex: " + parsed.error)
      return
    }
    if (!canSubmit) {
      toast.error("Enter at least one valid IPv4 address or a regex pattern")
      return
    }
    if (parsed.kind === "regex") {
      setCommitted({ kind: "regex", source: parsed.source })
    } else if (parsed.kind === "ips") {
      setCommitted({ kind: "ips", ips: parsed.ips })
    }
  }

  // Devices matching just the search predicate, ignoring filter pills.
  // Used both as the starting set for `matches` (after filters) and for
  // the `counts` shown next to each filter option in the dropdowns.
  const searchMatched = useMemo(() => {
    if (!committed) return null
    if (committed.kind === "ips") {
      const want = new Set(committed.ips)
      return devices.filter((d) => want.has(d.allocated_ip))
    }
    const rx = new RegExp(committed.source, "i")
    return devices.filter((d) => rx.test(d.allocated_ip))
  }, [committed, devices])

  // Per-filter-bucket counts within the search-matched set so the
  // dropdown rows can show "Online · 3 / Offline · 5". Keyed by the
  // option value (string) so it composes cleanly with `FilterDropdown`'s
  // `counts: Record<string, number>` API.
  const counts = useMemo(() => {
    const c = { online: 0, offline: 0, live: 0, paused: 0, revoked: 0 }
    if (!searchMatched) return c
    for (const d of searchMatched) {
      c[connState(d)] += 1
      c[peerState(d)] += 1
    }
    return c
  }, [searchMatched])

  // Final result set: search-matched devices, narrowed by the pills.
  const matches = useMemo(() => {
    if (!searchMatched) return null
    return searchMatched.filter((d) => {
      if (connFilter.size > 0 && !connFilter.has(connState(d))) return false
      if (peerFilter.size > 0 && !peerFilter.has(peerState(d))) return false
      return true
    })
  }, [searchMatched, connFilter, peerFilter])

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

  const placeholder = useRegex
    ? "^10\\.10\\.0\\..*  ·  192\\.168\\.[01]\\..*"
    : "10.10.0.5, 10.10.0.12, …"

  return (
    <div className="flex flex-col gap-6">
      <PageHead eyebrow="Workspace · 03" title="Finder" />

      <Panel
        title="Search by IP"
        sub={
          useRegex
            ? "Regex pattern (case-insensitive) tested against each device's allocated_ip"
            : "Comma-separated IPv4 addresses (exact match against allocated_ip)"
        }
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <div className="relative">
              <IconSearch
                className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={placeholder}
                className="pl-8 pr-9 font-mono"
                aria-invalid={
                  parsed.kind === "ips"
                    ? parsed.invalid.length > 0
                    : parsed.kind === "invalid-regex"
                }
                autoFocus
              />
              {queryInput && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setQueryInput("")}
                  aria-label="Clear"
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
            {parsed.kind === "ips" && parsed.invalid.length > 0 && (
              <p className="text-destructive mt-1 font-mono text-[11px]">
                Invalid IPv4: {parsed.invalid.join(", ")}
              </p>
            )}
            {parsed.kind === "invalid-regex" && (
              <p className="text-destructive mt-1 font-mono text-[11px]">
                Invalid regex: {parsed.error}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant={useRegex ? "default" : "outline"}
            onClick={() => setUseRegex((v) => !v)}
            aria-pressed={useRegex}
            title="Toggle regex mode"
            className="font-mono"
          >
            <IconRegex className="size-4" />
            <span className="ml-1 text-xs">.*</span>
          </Button>
          <Button type="submit" disabled={!canSubmit || devicesQ.isLoading}>
            <IconSearch className="size-4" />
            Search
          </Button>
        </form>

        {/* Filter dropdowns — same multi-select pattern the Devices page
            uses. Each dropdown opens a checkbox list, clicking a row
            toggles selection without closing. `counts` are computed
            against the current search-matched set so the user sees how
            many devices would survive each toggle. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
      </Panel>

      {devicesQ.isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-none" />
          ))}
        </div>
      )}

      {!devicesQ.isLoading && committed === null && (
        <Panel flush>
          <div className="p-4">
            <EmptyState
              icon={IconUserSearch}
              title="No search yet"
              description="Enter one or more IPv4 addresses (or flip the .* toggle for regex) to look up the matching devices."
            />
          </div>
        </Panel>
      )}

      {!devicesQ.isLoading &&
        committed &&
        matches &&
        matches.length === 0 && (
          <Panel flush>
            <div className="p-4">
              <EmptyState
                icon={IconDeviceDesktop}
                title="No peers match"
                description={
                  committed.kind === "ips"
                    ? `Searched ${committed.ips.length} IP${committed.ips.length === 1 ? "" : "s"} — none matched after filters. Loosen the connection / peer filters or check the addresses.`
                    : `Regex /${committed.source}/ matched nothing after filters. Loosen the connection / peer filters or try a broader pattern.`
                }
              />
            </div>
          </Panel>
        )}

      {matches && matches.length > 0 && (
        <div className="space-y-2">
          <Eyebrow>
            {matches.length} match{matches.length === 1 ? "" : "es"}
            {committed?.kind === "ips" && ` · searched ${committed.ips.length}`}
            {committed?.kind === "regex" && ` · regex /${committed.source}/`}
            {totalFilters > 0 && ` · ${totalFilters} filter${totalFilters === 1 ? "" : "s"}`}
          </Eyebrow>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {matches.map((d) => (
              <FinderCard key={d.id} device={d} live={liveDevices[d.id]} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Last N frames of live history to render on the Finder card's mini
 *  chart. The store retains up to 1800 frames (30 min at 1 Hz) but the
 *  card is small — a shorter window keeps the trace readable and stops
 *  the Y axis being pulled by an hour-old spike. */
const CHART_WINDOW = 30

/** Read-only peer card for the Finder grid. Same visual rhythm as the
 *  Dashboard's DeviceCard but without the action menu — clicking through
 *  takes the user to the device-detail page for manage operations.
 *
 *  Rates are gated on `connState(d) === "online"` (recent handshake)
 *  rather than just `status === "active"` so a device that hasn't
 *  handshook in 3 minutes shows "—" instead of the stale rate the store
 *  still holds from before it dropped. */
function FinderCard({
  device: d,
  live,
}: {
  device: PublicDevice
  live: ReturnType<typeof useLiveStats.getState>["devices"][string] | undefined
}) {
  const isOnline = connState(d) === "online"
  const rxBps = isOnline ? (live?.rxBps ?? 0) : 0
  const txBps = isOnline ? (live?.txBps ?? 0) : 0
  // Slice histories to the last N frames before handing them to the
  // chart. When the device is offline we feed empty arrays so the chart
  // doesn't keep painting stale lines.
  const rxHistory = useMemo(
    () => (isOnline ? (live?.rxHistory ?? []).slice(-CHART_WINDOW) : []),
    [isOnline, live?.rxHistory],
  )
  const txHistory = useMemo(
    () => (isOnline ? (live?.txHistory ?? []).slice(-CHART_WINDOW) : []),
    [isOnline, live?.txHistory],
  )
  return (
    <div className="zv-panel relative flex flex-col">
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
        <Link
          to={`/app/devices/${d.id}`}
          className="hover:text-foreground flex min-w-0 flex-col gap-0.5 transition-colors"
        >
          <span className="text-foreground truncate text-sm font-medium">
            {d.name}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            {d.os} · {d.allocated_ip}
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <StatusPill status={d.status as PillStatus} />
          <Link
            to={`/app/devices/${d.id}`}
            aria-label="Open device"
            className="text-muted-foreground hover:text-foreground -mr-1 p-1 transition-colors"
          >
            <IconExternalLink className="size-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <RateBlock
          label="↓ RX"
          value={isOnline ? formatBps(rxBps) : "—"}
          color="text-status-online"
        />
        <RateBlock
          label="↑ TX"
          value={isOnline ? formatBps(txBps) : "—"}
          color="text-primary"
        />
      </div>

      <div className="-mb-4 px-1">
        <MiniAreaChart rxHistory={rxHistory} txHistory={txHistory} height={56} />
      </div>

      <div className="border-border bg-muted/40 flex items-center justify-between gap-3 border-t px-4 py-2.5 font-mono text-[11px]">
        <span className="text-muted-foreground inline-flex items-center gap-1.5">
          <span className="bg-status-paused size-1 rounded-full" aria-hidden />
          <RelativeTime value={d.last_handshake_at} fallback="Never" />
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-2 tabular-nums">
          <span className="inline-flex items-center gap-0.5">
            <IconArrowDown className="size-2.5" />
            {compactBytes(live?.totalRx ?? 0)}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <IconArrowUp className="size-2.5" />
            {compactBytes(live?.totalTx ?? 0)}
          </span>
        </span>
      </div>
    </div>
  )
}

function RateBlock({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="space-y-0.5">
      <p
        className={`font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${color}`}
      >
        {label}
      </p>
      <p className="text-foreground font-heading text-base font-medium tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  )
}
