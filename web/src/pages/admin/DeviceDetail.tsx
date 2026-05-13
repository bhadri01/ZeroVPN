import { useQuery } from "@tanstack/react-query"
import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react"
import { useState } from "react"
import { Link, useParams } from "react-router"

import { BandwidthChart } from "@/components/charts/LazyBandwidthChart"
import { CopyableCode } from "@/components/CopyableCode"
import { PageStagger, StaggerItem } from "@/components/motion"
import { RelativeTime } from "@/components/RelativeTime"
import {
  Eyebrow,
  Kbd,
  Kpi,
  KpiStrip,
  PageHead,
  Panel,
  Pill,
  type PillTone,
} from "@/components/swiss"
import { StatusPill, type Status } from "@/components/StatusPill"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ApiError,
  type BandwidthRange,
  type ConnectionSessionRow,
  type DeviceStatus,
  type EndpointHistoryRow,
  adminDeviceBandwidth,
  adminGetDeviceDetail,
  adminListDeviceConnectionHistory,
  adminListDeviceEndpointHistory,
} from "@/lib/api"
import { formatBytes } from "@/lib/units"

const DEVICE_STATUS_TO_PILL: Record<DeviceStatus, Status> = {
  active: "active",
  paused: "paused",
  revoked: "revoked",
}

const RANGE_OPTIONS: { value: BandwidthRange; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 d" },
  { value: "30d", label: "30 d" },
]

export function AdminDeviceDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const detailQ = useQuery({
    queryKey: ["admin", "device", id],
    queryFn: () => adminGetDeviceDetail(id),
    enabled: id.length > 0,
  })
  const [bwRange, setBwRange] = useState<BandwidthRange>("24h")
  const bwQ = useQuery({
    queryKey: ["admin", "device", id, "bandwidth", bwRange],
    queryFn: () => adminDeviceBandwidth(id, bwRange),
    enabled: id.length > 0,
  })
  const endpointQ = useQuery({
    queryKey: ["admin", "device", id, "endpoint-history"],
    queryFn: () => adminListDeviceEndpointHistory(id),
    enabled: id.length > 0,
  })
  const connectionQ = useQuery({
    queryKey: ["admin", "device", id, "connection-history"],
    queryFn: () => adminListDeviceConnectionHistory(id),
    enabled: id.length > 0,
  })

  const d = detailQ.data?.device
  const owner = detailQ.data?.owner
  const endpoints: EndpointHistoryRow[] = endpointQ.data ?? []
  const connections: ConnectionSessionRow[] = connectionQ.data ?? []

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Admin · device"
          title={d?.name ?? (detailQ.isLoading ? "Loading…" : "Unknown device")}
          sub={
            d
              ? `${d.os} · ${d.allocated_ip}`
              : detailQ.isLoading
                ? undefined
                : "Device not found"
          }
          right={
            <div className="flex items-center gap-2">
              {owner && (
                <Button asChild size="sm" variant="outline">
                  <Link to={`/admin/users/${owner.id}`}>
                    <IconArrowLeft className="size-3.5" />
                    Back to {owner.email.split("@")[0]}
                  </Link>
                </Button>
              )}
              {d && (
                <StatusPill
                  status={DEVICE_STATUS_TO_PILL[d.status] ?? "offline"}
                  label={d.status}
                />
              )}
            </div>
          }
        />
      </StaggerItem>

      {detailQ.isError && (
        <StaggerItem>
          <Panel title="Failed to load">
            <p className="text-muted-foreground text-sm">
              {detailQ.error instanceof ApiError
                ? detailQ.error.message
                : "Could not fetch device."}
            </p>
          </Panel>
        </StaggerItem>
      )}

      {detailQ.isLoading && (
        <StaggerItem>
          <Skeleton className="h-32 rounded-none" />
        </StaggerItem>
      )}

      {d && owner && (
        <>
          <StaggerItem>
            <KpiStrip>
              <Kpi
                label="Owner"
                value={owner.email.split("@")[0]}
                footL={owner.email}
                footR={
                  <Link
                    to={`/admin/users/${owner.id}`}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    user detail <IconExternalLink className="size-3" />
                  </Link>
                }
              />
              <Kpi
                label="Last handshake"
                value={
                  d.last_handshake_at ? (
                    <RelativeTime
                      value={d.last_handshake_at}
                      fallback="Never"
                    />
                  ) : (
                    "Never"
                  )
                }
                footL="WireGuard heartbeat"
              />
              <Kpi
                label="Last endpoint"
                value={
                  d.last_peer_endpoint ? (
                    <span className="font-mono text-base">
                      {d.last_peer_endpoint}
                    </span>
                  ) : (
                    "—"
                  )
                }
                footL={
                  d.last_peer_endpoint_at ? (
                    <RelativeTime value={d.last_peer_endpoint_at} />
                  ) : (
                    "no handshake yet"
                  )
                }
              />
              <Kpi
                label="Created"
                value={<RelativeTime value={d.created_at} />}
                footL={d.private_key_stored ? "key stored on server" : "zero-knowledge key"}
              />
            </KpiStrip>
          </StaggerItem>

          <StaggerItem>
            <Panel
              title="Bandwidth"
              sub="Per-device rollups: hourly for 24h/7d, daily for 30d"
              right={
                <div className="flex items-center gap-1 font-mono text-[11px]">
                  {RANGE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setBwRange(o.value)}
                      className={`hover:text-foreground transition-colors ${
                        bwRange === o.value
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              }
            >
              {bwQ.isLoading ? (
                <Skeleton className="h-[220px] rounded-none" />
              ) : (
                <BandwidthChart
                  buckets={bwQ.data?.buckets ?? []}
                  height={220}
                />
              )}
            </Panel>
          </StaggerItem>

          <StaggerItem>
            <Panel
              title="Configuration"
              sub="Public key, peer overrides, DNS names"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Eyebrow>Public key</Eyebrow>
                  <CopyableCode value={d.public_key} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Eyebrow>Allocated IP</Eyebrow>
                  <CopyableCode value={d.allocated_ip} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Eyebrow>Allowed IPs override</Eyebrow>
                  {d.allowed_ips_override && d.allowed_ips_override.length > 0 ? (
                    <CopyableCode value={d.allowed_ips_override.join(", ")} />
                  ) : (
                    <p className="text-muted-foreground font-mono text-xs">
                      none · full-tunnel default
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Eyebrow>DNS override</Eyebrow>
                  {d.dns_override && d.dns_override.length > 0 ? (
                    <CopyableCode value={d.dns_override.join(", ")} />
                  ) : (
                    <p className="text-muted-foreground font-mono text-xs">
                      none · server default
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <Eyebrow>DNS names</Eyebrow>
                  {d.dns_names.length > 0 ? (
                    <CopyableCode value={d.dns_names.join(", ")} />
                  ) : (
                    <p className="text-muted-foreground font-mono text-xs">
                      none assigned
                    </p>
                  )}
                </div>
              </div>
            </Panel>
          </StaggerItem>

          <StaggerItem>
            <Panel
              title="Endpoint history"
              sub={`${endpoints.length}${endpoints.length === 200 ? "+" : ""} distinct WG endpoints, newest first`}
              flush
            >
              {endpointQ.isLoading ? (
                <Skeleton className="h-20 rounded-none" />
              ) : endpoints.length > 0 ? (
                <div className="zv-table-scroll">
                  <table className="zv-table">
                    <thead>
                      <tr>
                        <th>Endpoint</th>
                        <th className="w-[200px]">First seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {endpoints.slice(0, 50).map((r) => (
                        <tr key={r.id}>
                          <td className="font-mono text-xs">{r.endpoint}</td>
                          <td className="text-muted-foreground font-mono text-xs">
                            <RelativeTime value={r.observed_at} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-muted-foreground py-8 text-center font-mono text-sm">
                  No endpoints captured yet.
                </div>
              )}
              {endpoints.length > 50 && (
                <p className="text-muted-foreground p-2 font-mono text-[11px]">
                  Showing first 50 of {endpoints.length}.
                </p>
              )}
            </Panel>
          </StaggerItem>

          <StaggerItem>
            <Panel
              title="Connection sessions"
              sub={`${connections.length}${connections.length === 200 ? "+" : ""} sessions, newest first · open sessions show "active"`}
              flush
            >
              {connectionQ.isLoading ? (
                <Skeleton className="h-20 rounded-none" />
              ) : connections.length > 0 ? (
                <div className="zv-table-scroll">
                  <table className="zv-table">
                    <thead>
                      <tr>
                        <th className="w-[180px]">Started</th>
                        <th className="w-[110px]">Duration</th>
                        <th>Endpoint</th>
                        <th className="text-right">RX</th>
                        <th className="text-right">TX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {connections.slice(0, 50).map((s) => {
                        const open = s.ended_at == null
                        const duration = open
                          ? "active"
                          : formatDuration(s.started_at, s.ended_at!)
                        const rx =
                          s.rx_bytes_at_end != null
                            ? Math.max(
                                0,
                                s.rx_bytes_at_end - s.rx_bytes_at_start,
                              )
                            : null
                        const tx =
                          s.tx_bytes_at_end != null
                            ? Math.max(
                                0,
                                s.tx_bytes_at_end - s.tx_bytes_at_start,
                              )
                            : null
                        const endpointChanged =
                          !open &&
                          s.peer_endpoint_at_end != null &&
                          s.peer_endpoint_at_end !== s.peer_endpoint_at_start
                        return (
                          <tr key={s.id}>
                            <td className="text-muted-foreground font-mono text-xs">
                              <RelativeTime value={s.started_at} />
                            </td>
                            <td className="font-mono text-xs tabular-nums">
                              {open ? (
                                <Pill tone="ok" dot>
                                  active
                                </Pill>
                              ) : (
                                duration
                              )}
                            </td>
                            <td className="font-mono text-xs">
                              {s.peer_endpoint_at_start ?? (
                                <span className="text-muted-foreground">
                                  —
                                </span>
                              )}
                              {endpointChanged && (
                                <span
                                  className="text-muted-foreground"
                                  title={`Ended on ${s.peer_endpoint_at_end}`}
                                >
                                  {" → "}
                                  {s.peer_endpoint_at_end}
                                </span>
                              )}
                            </td>
                            <td className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                              {rx != null ? (
                                formatBytes(rx)
                              ) : (
                                <span className="text-muted-foreground">
                                  —
                                </span>
                              )}
                            </td>
                            <td className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                              {tx != null ? (
                                formatBytes(tx)
                              ) : (
                                <span className="text-muted-foreground">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-muted-foreground py-8 text-center font-mono text-sm">
                  No connection sessions yet.
                </div>
              )}
              {connections.length > 50 && (
                <p className="text-muted-foreground p-2 font-mono text-[11px]">
                  Showing first 50 of {connections.length}.
                </p>
              )}
            </Panel>
          </StaggerItem>

          <StaggerItem>
            <Panel
              title="Recent activity"
              sub="Audit entries targeting this device, newest first"
              flush
            >
              {detailQ.data && detailQ.data.activity.length > 0 ? (
                <div className="zv-table-scroll">
                  <table className="zv-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Metadata</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailQ.data.activity.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <Pill tone={toneForAction(a.action)} dot={false}>
                              {a.action}
                            </Pill>
                          </td>
                          <td className="text-muted-foreground font-mono text-[11px]">
                            <Kbd>{summarize(a.metadata)}</Kbd>
                          </td>
                          <td className="text-muted-foreground font-mono text-xs">
                            <RelativeTime value={a.created_at} fallback="—" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-muted-foreground py-8 text-center font-mono text-sm">
                  No activity.
                </div>
              )}
            </Panel>
          </StaggerItem>

          {/* Trailing meta strip: device + server ids for ops handoff */}
          <StaggerItem>
            <Panel title="Identifiers" sub="For ops / debugging">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Eyebrow>Device id</Eyebrow>
                  <CopyableCode value={d.id} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Eyebrow>Server id</Eyebrow>
                  <CopyableCode value={d.server_id} />
                </div>
              </div>
            </Panel>
          </StaggerItem>
        </>
      )}
    </PageStagger>
  )
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return "—"
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) {
    const s = totalSec % 60
    return `${totalMin}m ${s.toString().padStart(2, "0")}s`
  }
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m.toString().padStart(2, "0")}m`
}

function summarize(metadata: unknown): string {
  if (metadata == null || typeof metadata !== "object") return "—"
  const obj = metadata as Record<string, unknown>
  if (Object.keys(obj).length === 0) return "—"
  const parts: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue
    if (typeof v === "object") continue
    parts.push(`${k}=${String(v)}`)
    if (parts.length >= 3) break
  }
  return parts.length > 0 ? parts.join(" · ") : "—"
}

function toneForAction(action: string): PillTone {
  if (action.endsWith(".online")) return "ok"
  if (action.endsWith(".offline")) return "neutral"
  if (action.includes("revoke") || action.includes("delete")) return "err"
  if (action.includes("pause") || action.includes("disable")) return "warn"
  if (action.includes("create")) return "ok"
  return "info"
}
