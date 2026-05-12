import { useQuery } from "@tanstack/react-query"
import {
  IconDeviceDesktop,
  IconRegex,
  IconSearch,
  IconUserSearch,
  IconX,
} from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { DeviceCard } from "@/components/DeviceCard"
import { EmptyState } from "@/components/EmptyState"
import { FilterDropdown } from "@/components/FilterDropdown"
import { AnimatedList, FadeIn, PageStagger, StaggerItem } from "@/components/motion"
import { Eyebrow, PageHead, Panel } from "@/components/swiss"
import { type Status as PillStatus } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { WithTooltip } from "@/components/ui/with-tooltip"
import { listDevices } from "@/lib/api"
import {
  connState,
  peerState,
  type ConnState,
  type PeerState,
} from "@/lib/deviceState"

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
    <PageStagger>
      <StaggerItem>
        <PageHead eyebrow="Workspace · 03" title="Finder" />
      </StaggerItem>

      <StaggerItem>
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
                <WithTooltip label="Clear search">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2"
                    onClick={() => setQueryInput("")}
                    aria-label="Clear"
                  >
                    <IconX size={14} />
                  </button>
                </WithTooltip>
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
      </StaggerItem>

      {devicesQ.isLoading && (
        <StaggerItem>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-none" />
            ))}
          </div>
        </StaggerItem>
      )}

      {!devicesQ.isLoading && committed === null && (
        <StaggerItem>
          <Panel flush>
            <div className="p-4">
              <EmptyState
                icon={IconUserSearch}
                title="No search yet"
                description="Enter one or more IPv4 addresses (or flip the .* toggle for regex) to look up the matching devices."
              />
            </div>
          </Panel>
        </StaggerItem>
      )}

      {!devicesQ.isLoading &&
        committed &&
        matches &&
        matches.length === 0 && (
          <FadeIn>
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
          </FadeIn>
        )}

      {matches && matches.length > 0 && (
        <StaggerItem>
          <div className="space-y-2">
            <Eyebrow>
              {matches.length} match{matches.length === 1 ? "" : "es"}
              {committed?.kind === "ips" && ` · searched ${committed.ips.length}`}
              {committed?.kind === "regex" && ` · regex /${committed.source}/`}
              {totalFilters > 0 && ` · ${totalFilters} filter${totalFilters === 1 ? "" : "s"}`}
            </Eyebrow>
            {/* AnimatedList gives each result card its own enter/exit
                so changing search or toggling filters slides items in
                and out instead of flashing. */}
            <AnimatedList className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {matches.map((d) => (
                <DeviceCard key={d.id} device={d} />
              ))}
            </AnimatedList>
          </div>
        </StaggerItem>
      )}
    </PageStagger>
  )
}

