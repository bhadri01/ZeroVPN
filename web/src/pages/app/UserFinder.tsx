import { useQuery } from "@tanstack/react-query"
import {
  IconChevronRight,
  IconDeviceDesktop,
  IconNetwork,
  IconSearch,
  IconX,
} from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { Link } from "react-router"

import { PageStagger, StaggerItem } from "@/components/motion"
import { Kbd, PageHead, Panel } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { listDevices, meServer, type PublicDevice } from "@/lib/api"
import { connState } from "@/lib/deviceState"

/**
 * User Finder — the non-privileged counterpart to the admin Finder.
 *
 * A regular user pastes a VPN IP and learns which of *their own* devices
 * holds it, plus whether the address is inside the VPN subnet. It is
 * deliberately scoped to the caller's own devices and computed entirely
 * client-side from data the user already has (`/devices` + `/me/server`),
 * so it exposes nothing about other users' peers — the fleet-wide lookup
 * (emails, other users' devices, source endpoints, log counts) stays in
 * the admin-only Finder.
 */

/** Strip a trailing CIDR suffix and whitespace: "10.10.0.5/32" → "10.10.0.5". */
function bareIp(v: string): string {
  return v.trim().split("/")[0]?.trim() ?? ""
}

/** Parse a dotted-quad IPv4 into a uint32, or null if malformed. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let acc = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    acc = acc * 256 + n
  }
  return acc >>> 0
}

/** Is `ip` inside `cidr` (e.g. "10.10.0.0/22")? IPv4 only. */
function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/")
  const bits = Number(bitsStr)
  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(base ?? "")
  if (ipInt === null || baseInt === null || !(bits >= 0 && bits <= 32)) {
    return false
  }
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

export function UserFinderPage() {
  const [input, setInput] = useState("")
  const [committed, setCommitted] = useState("")

  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
  const serverQ = useQuery({ queryKey: ["me", "server"], queryFn: meServer })
  const cidr = serverQ.data?.cidr

  const submit = () => setCommitted(bareIp(input))
  const clear = () => {
    setInput("")
    setCommitted("")
  }

  const result = useMemo(() => {
    if (!committed) return null
    const ip = bareIp(committed)
    if (ipv4ToInt(ip) === null) {
      return { kind: "invalid" as const, ip }
    }
    const match = (devicesQ.data ?? []).find(
      (d) => bareIp(d.allocated_ip) === ip,
    )
    if (match) return { kind: "mine" as const, ip, device: match }
    if (cidr && ipInCidr(ip, cidr)) {
      return { kind: "in-subnet" as const, ip }
    }
    return { kind: "outside" as const, ip }
  }, [committed, devicesQ.data, cidr])

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Workspace · Finder"
          title="Finder"
          sub="paste a VPN IP · find which of your devices holds it"
        />
      </StaggerItem>

      <StaggerItem>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <IconSearch className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit()
              }}
              placeholder={cidr ? `e.g. ${cidr.split("/")[0]}` : "e.g. 10.10.0.5"}
              inputMode="decimal"
              autoFocus
              className="pl-9 pr-9 font-mono"
              aria-label="VPN IP address"
            />
            {input && (
              <button
                type="button"
                onClick={clear}
                aria-label="Clear"
                className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1"
              >
                <IconX className="size-4" />
              </button>
            )}
          </div>
          <Button onClick={submit} disabled={!input.trim()}>
            Look up
          </Button>
        </div>
      </StaggerItem>

      {!committed && (
        <StaggerItem>
          <Panel title="What this does">
            <div className="text-muted-foreground space-y-3 text-sm">
              <p>
                Enter a VPN IP address and Finder tells you which of your own
                devices is assigned to it, and whether the address sits inside
                your VPN subnet.
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <span>Your VPN subnet:</span>
                {cidr ? (
                  <Kbd>{cidr}</Kbd>
                ) : (
                  <span className="opacity-60">loading…</span>
                )}
              </p>
              <p className="text-xs opacity-70">
                Finder only searches your own devices. Looking up who else holds
                an address across the whole fleet is an admin-only tool.
              </p>
            </div>
          </Panel>
        </StaggerItem>
      )}

      {result && (
        <StaggerItem>
          {result.kind === "invalid" && (
            <Panel title="Not an IP address">
              <p className="text-muted-foreground text-sm">
                <span className="text-foreground font-mono">{result.ip}</span>{" "}
                isn&apos;t a valid IPv4 address. Try something like{" "}
                <span className="font-mono">10.10.0.5</span>.
              </p>
            </Panel>
          )}

          {result.kind === "mine" && (
            <DeviceResult ip={result.ip} device={result.device} />
          )}

          {result.kind === "in-subnet" && (
            <Panel title="Inside your VPN subnet">
              <p className="text-muted-foreground text-sm">
                <span className="text-foreground font-mono">{result.ip}</span> is
                inside your VPN subnet{cidr ? ` (${cidr})` : ""} but isn&apos;t
                assigned to any of your devices. It may belong to another peer or
                be unassigned.
              </p>
            </Panel>
          )}

          {result.kind === "outside" && (
            <Panel title="Not a VPN address">
              <p className="text-muted-foreground text-sm">
                <span className="text-foreground font-mono">{result.ip}</span> is
                outside your VPN subnet{cidr ? ` (${cidr})` : ""}, so it
                isn&apos;t a ZeroVPN peer address.
              </p>
            </Panel>
          )}
        </StaggerItem>
      )}
    </PageStagger>
  )
}

function DeviceResult({ ip, device }: { ip: string; device: PublicDevice }) {
  const online = connState(device) === "online"
  return (
    <Link
      to={`/app/devices/${device.id}`}
      className="border-border bg-card hover:border-foreground/30 group flex items-center gap-4 rounded-md border p-4 transition-colors"
    >
      <div className="bg-secondary grid size-10 shrink-0 place-items-center rounded-md">
        <IconDeviceDesktop className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{device.name}</span>
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide"
            style={{
              color: online
                ? "var(--status-online)"
                : "var(--muted-foreground)",
            }}
          >
            <span
              className="size-1.5 rounded-full"
              style={{
                background: online
                  ? "var(--status-online)"
                  : "var(--status-offline)",
              }}
            />
            {online ? "online" : "offline"}
          </span>
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono text-xs">
          <IconNetwork className="size-3.5" />
          {ip}
          <span className="opacity-50">· your device</span>
        </div>
      </div>
      <IconChevronRight className="text-muted-foreground group-hover:text-foreground size-5 shrink-0" />
    </Link>
  )
}
