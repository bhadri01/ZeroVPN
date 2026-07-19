import { useQuery } from "@tanstack/react-query"
import { IconSearch, IconX } from "@tabler/icons-react"
import { useMemo, useState } from "react"

import {
  FinderDeviceCard,
  OwnerAccordion,
} from "@/components/finder/FinderResults"
import { PageStagger, StaggerItem } from "@/components/motion"
import { parseTokens } from "@/lib/finder"
import { Kbd, PageHead, Panel } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDeviceOnline } from "@/hooks/useDeviceOnline"
import { useHistoryHydration } from "@/hooks/useHistoryHydration"
import { listDevices, meServer, type PublicDevice } from "@/lib/api"
import { useAuth } from "@/stores/auth"

/**
 * User Finder — the non-privileged counterpart to the admin Finder.
 *
 * A regular user pastes one or more VPN IPs and learns which of *their
 * own* devices hold them, plus whether each address is inside the VPN
 * subnet. It is deliberately scoped to the caller's own devices and
 * computed entirely client-side from data the user already has
 * (`/devices` + `/me/server`), so it exposes nothing about other users'
 * peers — the fleet-wide lookup (emails, other users' devices, source
 * endpoints, log counts) stays in the admin-only Finder.
 *
 * Matched devices render inside an accordion section headed by the
 * account email — the same owner-grouped presentation the admin Finder
 * uses — with a live card per device (name · IP · RX/TX · sparkline).
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

type Lookup =
  | { kind: "mine"; ip: string; device: PublicDevice }
  | { kind: "in-subnet"; ip: string }
  | { kind: "outside"; ip: string }
  | { kind: "invalid"; ip: string }

export function UserFinderPage() {
  const [input, setInput] = useState("")
  const [committed, setCommitted] = useState("")

  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
  const serverQ = useQuery({ queryKey: ["me", "server"], queryFn: meServer })
  const cidr = serverQ.data?.cidr
  const user = useAuth((s) => s.user)

  const submit = () => setCommitted(input.trim())
  const clear = () => {
    setInput("")
    setCommitted("")
  }

  // One lookup per pasted value — commas, spaces, and newlines all
  // separate. Each token resolves independently against the caller's
  // own devices.
  const lookups: Lookup[] = useMemo(() => {
    if (!committed) return []
    return parseTokens(committed).map((ip) => {
      if (ipv4ToInt(ip) === null) return { kind: "invalid" as const, ip }
      const match = (devicesQ.data ?? []).find(
        (d) => bareIp(d.allocated_ip) === ip,
      )
      if (match) return { kind: "mine" as const, ip, device: match }
      if (cidr && ipInCidr(ip, cidr)) {
        return { kind: "in-subnet" as const, ip }
      }
      return { kind: "outside" as const, ip }
    })
  }, [committed, devicesQ.data, cidr])

  const matched = lookups.flatMap((l) => (l.kind === "mine" ? [l] : []))
  const unmatched = lookups.filter((l) => l.kind !== "mine")

  // Seed the matched devices' sparklines from history so the cards show
  // a trace immediately instead of building up frame-by-frame. Key the
  // memo on the joined-id string so a stable match set keeps a stable
  // array identity across re-renders.
  const matchedIdsKey = matched.map((m) => m.device.id).join("|")
  const matchedIds = useMemo(
    () => (matchedIdsKey ? matchedIdsKey.split("|") : []),
    [matchedIdsKey],
  )
  useHistoryHydration({ deviceIds: matchedIds })

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Workspace · Finder"
          title="Finder"
          sub="paste one or more VPN IPs · find which of your devices hold them"
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
              onPaste={(e) => {
                // Multi-line clipboard lists (one IP per line) lose
                // their newlines in a single-line input — normalize to
                // spaces so every pasted value survives as a token.
                const text = e.clipboardData.getData("text")
                if (/[\r\n]/.test(text)) {
                  e.preventDefault()
                  const cleaned = text.replace(/[\s,]+/g, " ").trim()
                  setInput((cur) =>
                    cur.trim() ? `${cur.trim()} ${cleaned}` : cleaned,
                  )
                }
              }}
              placeholder={
                cidr
                  ? `e.g. ${cidr.split("/")[0]} · comma or space separated`
                  : "e.g. 10.10.0.5, 10.10.0.7"
              }
              autoFocus
              className="pl-9 pr-9 font-mono"
              aria-label="VPN IP addresses"
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
                Enter one or more VPN IP addresses — separated by commas,
                spaces, or newlines — and Finder tells you which of your own
                devices hold them, and whether each address sits inside your
                VPN subnet.
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
                Finder only searches your own devices. Looking up who else
                holds an address across the whole fleet is an admin-only
                tool.
              </p>
            </div>
          </Panel>
        </StaggerItem>
      )}

      {committed && matched.length > 0 && (
        <StaggerItem>
          <OwnerAccordion
            email={user?.email ?? "your devices"}
            count={matched.length}
          >
            {matched.map((m) => (
              <OwnDeviceCard key={m.device.id} device={m.device} ip={m.ip} />
            ))}
          </OwnerAccordion>
        </StaggerItem>
      )}

      {committed && unmatched.length > 0 && (
        <StaggerItem>
          <Panel title={matched.length > 0 ? "Other addresses" : "No matches"}>
            <div className="divide-border -m-4 flex flex-col divide-y">
              {unmatched.map((l) => (
                <div
                  key={l.ip}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 font-mono text-xs"
                >
                  <span className="text-foreground shrink-0">{l.ip}</span>
                  <span className="text-muted-foreground text-right">
                    {l.kind === "invalid" &&
                      "not a valid IPv4 address"}
                    {l.kind === "in-subnet" &&
                      `inside your VPN subnet${cidr ? ` (${cidr})` : ""} · not one of your devices`}
                    {l.kind === "outside" &&
                      `outside your VPN subnet${cidr ? ` (${cidr})` : ""}`}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </StaggerItem>
      )}
    </PageStagger>
  )
}

/** Wrapper so `useDeviceOnline` (a hook, one per device) can feed the
 *  shared finder card its resolved connectivity state. */
function OwnDeviceCard({ device, ip }: { device: PublicDevice; ip: string }) {
  const online = useDeviceOnline(device)
  return (
    <FinderDeviceCard
      deviceId={device.id}
      name={device.name}
      ip={ip}
      to={`/app/devices/${device.id}`}
      online={online}
    />
  )
}
