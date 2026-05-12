import { Panel, Sparkline } from "@/components/swiss"
import type { DeviceOs, PublicDevice } from "@/lib/api"
import { formatBps } from "@/lib/units"

/** Top-of-page fleet summary. One Swiss card divided into three
 *  hairline-separated sections: Fleet (counts + online bar), Throughput
 *  (live TX/RX for the *filtered* set, with sparklines), Top traffic
 *  (top-3 ranked by current rate). Everything respects the current
 *  filter so the card and table never disagree. */
export function FleetSummary({
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
        {formatBps(value)}
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
