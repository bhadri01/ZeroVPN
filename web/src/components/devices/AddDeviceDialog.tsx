import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconChevronDown,
  IconCopy,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconQrcode,
} from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { CopyableCode } from "@/components/CopyableCode"
import { Eyebrow } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  ApiError,
  type CreatedDevice,
  type DeviceOs,
  type DnsCheck,
  checkDnsName,
  createDevice,
  listDevices,
  meServer,
  setDeviceDns,
} from "@/lib/api"
import { useAuth } from "@/stores/auth"

type IpMode = "auto" | "custom"

export function AddDeviceDialog({
  onCreated,
}: {
  onCreated: (d: CreatedDevice) => void
}) {
  const qc = useQueryClient()
  const user = useAuth((s) => s.user)
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

  // Existing devices for the inline name-uniqueness check. Shares the
  // same query key the parent table uses, so cache is reused — no extra
  // network round-trip.
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: listDevices })
  const existingNames = useMemo(
    () =>
      new Set(
        (devicesQ.data ?? []).map((d) => d.name.trim().toLowerCase()),
      ),
    [devicesQ.data],
  )

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
  useEffect(() => {
    if (serverDnsDefault && dnsInput === "") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDnsInput(serverDnsDefault)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDnsDefault])
  const [ipMode, setIpMode] = useState<IpMode>("auto")
  const [ipInput, setIpInput] = useState("")
  const [dnsPrefix, setDnsPrefix] = useState("")
  const [dnsTouched, setDnsTouched] = useState(false)
  // Default OFF — preserves the historical zero-knowledge guarantee.
  const [storePrivateKey, setStorePrivateKey] = useState(false)
  const [result, setResult] = useState<CreatedDevice | null>(null)

  const dnsLooksValid = useMemo(() => {
    if (!dnsInput.trim()) return true
    const parts = dnsInput.split(",").map((s) => s.trim()).filter(Boolean)
    return parts.every((p) => /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/.test(p))
  }, [dnsInput])

  const userSlug = useMemo(
    () => dnsLabelSlug(user?.email?.split("@")[0] ?? ""),
    [user?.email],
  )
  const nameSlug = useMemo(() => dnsLabelSlug(name), [name])

  const defaultDnsPrefix = useMemo(() => {
    if (nameSlug && userSlug) return `${nameSlug}.${userSlug}`
    return nameSlug || userSlug
  }, [nameSlug, userSlug])

  useEffect(() => {
    if (!dnsTouched) setDnsPrefix(defaultDnsPrefix)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDnsPrefix])

  const dnsFqdn = dnsPrefix ? `${dnsPrefix}.vpn.local` : ""

  const [debouncedFqdn, setDebouncedFqdn] = useState("")
  useEffect(() => {
    if (!dnsFqdn) {
      setDebouncedFqdn("")
      return
    }
    const t = setTimeout(() => setDebouncedFqdn(dnsFqdn), 350)
    return () => clearTimeout(t)
  }, [dnsFqdn])

  const dnsPrefixLocallyValid =
    dnsPrefix.length > 0 && isValidDnsPrefix(dnsPrefix)

  const dnsCheckQ = useQuery<DnsCheck>({
    queryKey: ["dns-check", debouncedFqdn],
    queryFn: () => checkDnsName(debouncedFqdn),
    enabled: debouncedFqdn.length > 0 && dnsPrefixLocallyValid,
    staleTime: 30_000,
    retry: false,
  })

  const dnsNameTaken =
    dnsCheckQ.data?.valid === true && dnsCheckQ.data.available === false
  const dnsNameAvailable =
    dnsCheckQ.data?.valid === true && dnsCheckQ.data.available === true

  const nameTaken =
    name.trim().length > 0 && existingNames.has(name.trim().toLowerCase())

  const ipValidation = useMemo<{ ok: boolean; error: string | null }>(() => {
    if (ipMode === "auto") return { ok: true, error: null }
    const v = ipInput.trim()
    if (!v) return { ok: false, error: null }
    if (
      !/^(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})$/.test(
        v,
      )
    ) {
      return { ok: false, error: "that doesn't look like a valid IPv4 address" }
    }
    if (serverCidr) {
      const reason = ipOutsideCidrReason(v, serverCidr)
      if (reason) return { ok: false, error: reason }
    }
    return { ok: true, error: null }
  }, [ipMode, ipInput, serverCidr])
  const ipLooksValid = ipValidation.ok

  const addM = useMutation({
    mutationFn: async () => {
      const dns = dnsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const created = await createDevice({
        name: name.trim(),
        os: osChoice,
        split_tunnel: splitTunnel || undefined,
        dns_override: dns.length > 0 ? dns : undefined,
        allocated_ip:
          ipMode === "custom" && ipInput.trim() ? ipInput.trim() : undefined,
        store_private_key: storePrivateKey || undefined,
      })
      if (dnsFqdn) {
        try {
          await setDeviceDns(created.device.id, [dnsFqdn])
        } catch (e) {
          const msg =
            e instanceof ApiError
              ? e.message
              : "DNS name could not be saved"
          toast.warning(`Device created — ${msg}`)
        }
      }
      return created
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
    !nameTaken &&
    dnsLooksValid &&
    ipLooksValid &&
    dnsPrefixLocallyValid &&
    dnsNameAvailable &&
    !addM.isPending

  const resetAll = () => {
    setStep(1)
    setName("")
    setOsChoice("other")
    setSplitTunnel(false)
    setDnsInput("")
    setIpMode("auto")
    setIpInput("")
    setStorePrivateKey(false)
    setResult(null)
    setDnsPrefix("")
    setDnsTouched(false)
  }

  return (
    <SheetContent
      side="right"
      showCloseButton={false}
      className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[820px]"
    >
      <SheetHeader className="border-border border-b">
        <SheetTitle>
          <Eyebrow num={`0${step}/02`}>Add device</Eyebrow>
        </SheetTitle>
        <SheetDescription>
          We generate a fresh keypair, allocate an IP, and hand you a WireGuard
          config. The private key never leaves the page.
        </SheetDescription>
      </SheetHeader>

      {step === 1 && (
        <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
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
              aria-invalid={nameTaken}
            />
            <p className="text-muted-foreground font-mono text-[11px]">
              1–64 chars. Used as the WireGuard interface name on the device.
              {nameTaken && (
                <span className="text-destructive ml-2">
                  you already have a device with this name
                </span>
              )}
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dev-dns-name" className="zv-eyebrow">
              DNS name
            </Label>
            <div
              data-invalid={
                (dnsPrefix.length > 0 && !dnsPrefixLocallyValid) ||
                dnsNameTaken
                  ? "1"
                  : undefined
              }
              className="border-input bg-transparent focus-within:border-ring focus-within:ring-ring/50 data-[invalid=1]:border-destructive data-[invalid=1]:ring-destructive/20 flex h-8 items-stretch overflow-hidden rounded-lg border transition-colors focus-within:ring-3 data-[invalid=1]:ring-3"
            >
              <input
                id="dev-dns-name"
                value={dnsPrefix}
                onChange={(e) => {
                  setDnsTouched(true)
                  setDnsPrefix(e.target.value.toLowerCase())
                }}
                placeholder={defaultDnsPrefix || "macbook-pro.bhadri"}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent px-2.5 py-1 font-mono text-sm outline-none"
              />
              <span className="border-input bg-muted/40 text-muted-foreground inline-flex shrink-0 items-center border-l px-2.5 font-mono text-[12px]">
                .vpn.local
              </span>
            </div>
            <DnsNameStatus
              prefix={dnsPrefix}
              locallyValid={dnsPrefixLocallyValid}
              checking={
                dnsCheckQ.isFetching && debouncedFqdn === dnsFqdn
              }
              taken={dnsNameTaken}
              available={dnsNameAvailable}
              defaultPrefix={defaultDnsPrefix}
              touched={dnsTouched}
              onReset={() => {
                setDnsTouched(false)
                setDnsPrefix(defaultDnsPrefix)
              }}
            />
          </div>

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
                  {ipValidation.error && (
                    <span className="text-destructive ml-2">
                      {ipValidation.error}
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

          <div className="border-border flex items-center gap-3 border p-3">
            <Switch
              checked={storePrivateKey}
              onCheckedChange={setStorePrivateKey}
              id="store-key"
            />
            <Label
              htmlFor="store-key"
              className="flex flex-1 cursor-pointer flex-col gap-0.5"
            >
              <span className="text-sm font-medium">
                Store private key on server
              </span>
              <span className="text-muted-foreground font-mono text-[11px]">
                Encrypted with the server's KEK and saved on the device row
                so you can re-download the .conf later from any device.
                Trades the zero-knowledge default for convenience. Default OFF.
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

        </div>
          <SheetFooter className="border-border flex-row justify-end gap-2 border-t">
            <SheetClose asChild>
              <Button variant="ghost" disabled={addM.isPending}>
                Cancel
              </Button>
            </SheetClose>
            <Button onClick={() => addM.mutate()} disabled={!canSubmit}>
              {addM.isPending ? "Generating…" : "Generate config →"}
            </Button>
          </SheetFooter>
        </div>
      )}

      {step === 2 && result && (
        <Step2Result
          result={result}
          onDone={() => {
            onCreated(result)
            resetAll()
          }}
        />
      )}
    </SheetContent>
  )
}

/**
 * Step-2 "config ready" pane. Fills the available side-sheet height
 * with a parsed view of the generated WireGuard config — [Interface]
 * and [Peer] cards rendered as compact key/value rows — instead of
 * leaving dead space below the QR. The raw .conf is still one click
 * away via the "View raw .conf" disclosure at the bottom.
 */
function Step2Result({
  result,
  onDone,
}: {
  result: CreatedDevice
  onDone: () => void
}) {
  const parsed = useMemo(() => parseWgConf(result.config), [result.config])
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
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

        {/* Interface / Peer cards — fill the formerly-empty space below
            the QR with the structured view of the .conf. Stack into a
            single column on narrow viewports. */}
        <div className="grid gap-3 md:grid-cols-2">
          <ConfigSection title="Interface" eyebrow="Local peer">
            <ConfigRow label="Address" value={parsed.interface.address} mono />
            <ConfigRow label="DNS" value={parsed.interface.dns} mono />
            <ConfigRow label="MTU" value={parsed.interface.mtu} mono />
            {parsed.interface.privateKey && (
              <SecretRow label="Private key" value={parsed.interface.privateKey} />
            )}
          </ConfigSection>

          <ConfigSection title="Peer" eyebrow="Remote server">
            <ConfigRow label="Public key" value={parsed.peer.publicKey} mono truncate />
            <ConfigRow label="Endpoint" value={parsed.peer.endpoint} mono />
            <ConfigRow label="Allowed IPs" value={parsed.peer.allowedIps} mono />
            <ConfigRow label="Keepalive" value={parsed.peer.keepalive} mono />
          </ConfigSection>
        </div>

        <details
          open={showRaw}
          onToggle={(e) => setShowRaw((e.target as HTMLDetailsElement).open)}
          className="border-border border"
        >
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors">
            <IconChevronDown
              className={`size-3.5 transition-transform ${showRaw ? "rotate-0" : "-rotate-90"}`}
            />
            View raw .conf
          </summary>
          <div className="border-border max-h-[260px] overflow-y-auto border-t">
            <CopyableCode value={result.config} multiline />
          </div>
        </details>
      </div>

      <SheetFooter className="border-border flex-row justify-end gap-2 border-t">
        <Button onClick={onDone}>Done</Button>
      </SheetFooter>
    </div>
  )
}

/** Bordered card with an eyebrow + title + body. Sized to match the rest
 *  of the dialog's visual rhythm. */
function ConfigSection({
  title,
  eyebrow,
  children,
}: {
  title: string
  eyebrow: string
  children: React.ReactNode
}) {
  return (
    <div className="border-border flex flex-col border">
      <div className="border-border border-b px-3 py-2">
        <div className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.08em]">
          {eyebrow}
        </div>
        <div className="text-foreground text-sm font-medium">{title}</div>
      </div>
      <dl className="flex flex-col">{children}</dl>
    </div>
  )
}

/** Single key/value row inside a ConfigSection. Renders dt/dd pair with
 *  a hairline divider on top so consecutive rows separate cleanly. */
function ConfigRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  truncate?: boolean
}) {
  return (
    <div className="border-border [&:not(:first-child)]:border-t flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className="text-muted-foreground shrink-0 font-mono text-[10px] uppercase tracking-[0.08em]">
        {label}
      </dt>
      <dd
        className={[
          "text-foreground min-w-0 text-right text-[12px]",
          mono ? "font-mono" : "",
          truncate ? "truncate" : "break-all",
        ].join(" ")}
        title={truncate && value ? value : undefined}
      >
        {value || <span className="text-muted-foreground/60">—</span>}
      </dd>
    </div>
  )
}

/** Like ConfigRow but for the private key: masked by default with an
 *  eye-toggle to reveal and a one-click copy. The plaintext only lives
 *  in component state — it's never stored after the sheet closes. */
function SecretRow({ label, value }: { label: string; value: string }) {
  const [revealed, setRevealed] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Clipboard blocked — copy from the raw .conf instead")
    }
  }
  return (
    <div className="border-border [&:not(:first-child)]:border-t flex items-center justify-between gap-3 px-3 py-2">
      <dt className="text-muted-foreground shrink-0 font-mono text-[10px] uppercase tracking-[0.08em]">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-1.5">
        <span
          className={[
            "text-foreground max-w-[180px] truncate font-mono text-[12px] sm:max-w-[260px]",
            revealed ? "" : "tracking-[0.15em]",
          ].join(" ")}
        >
          {revealed ? value : "•".repeat(Math.min(24, value.length))}
        </span>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="text-muted-foreground hover:text-foreground border-border hover:border-foreground inline-flex size-6 shrink-0 items-center justify-center border transition-colors"
          aria-label={revealed ? "Hide private key" : "Reveal private key"}
        >
          {revealed ? (
            <IconEyeOff className="size-3.5" />
          ) : (
            <IconEye className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-muted-foreground hover:text-foreground border-border hover:border-foreground inline-flex size-6 shrink-0 items-center justify-center border transition-colors"
          aria-label={`Copy ${label}`}
        >
          <IconCopy className="size-3.5" />
        </button>
      </dd>
    </div>
  )
}

interface ParsedConf {
  interface: {
    address?: string
    dns?: string
    mtu?: string
    privateKey?: string
  }
  peer: {
    publicKey?: string
    endpoint?: string
    allowedIps?: string
    keepalive?: string
  }
}

/** Minimal WireGuard .conf parser. Walks the [section] / Key = Value
 *  lines the server emits — order-independent, comment-tolerant — and
 *  surfaces the four-or-so fields we want to show on each card. Anything
 *  unrecognised is ignored: the source of truth is still the raw .conf
 *  available through the disclosure below. */
function parseWgConf(src: string): ParsedConf {
  const out: ParsedConf = { interface: {}, peer: {} }
  let section: "interface" | "peer" | "" = ""
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      const tag = sec[1].toLowerCase()
      section = tag === "interface" ? "interface" : tag === "peer" ? "peer" : ""
      continue
    }
    const eq = line.indexOf("=")
    if (eq < 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (section === "interface") {
      if (key === "address") out.interface.address = value
      else if (key === "dns") out.interface.dns = value
      else if (key === "mtu") out.interface.mtu = value
      else if (key === "privatekey") out.interface.privateKey = value
    } else if (section === "peer") {
      if (key === "publickey") out.peer.publicKey = value
      else if (key === "endpoint") out.peer.endpoint = value
      else if (key === "allowedips") out.peer.allowedIps = value
      else if (key === "persistentkeepalive") {
        out.peer.keepalive = /^\d+$/.test(value) ? `${value}s` : value
      }
    }
  }
  return out
}

function DnsNameStatus({
  prefix,
  locallyValid,
  checking,
  taken,
  available,
  defaultPrefix,
  touched,
  onReset,
}: {
  prefix: string
  locallyValid: boolean
  checking: boolean
  taken: boolean
  available: boolean
  defaultPrefix: string
  touched: boolean
  onReset: () => void
}) {
  let body: React.ReactNode
  if (!prefix) {
    body = "Required. Defaults to <device>.<user>.vpn.local."
  } else if (!locallyValid) {
    body = (
      <span className="text-destructive">
        invalid hostname — labels are 1–30 lowercase chars (letters,
        digits, hyphens), separated by dots, no leading/trailing hyphen
      </span>
    )
  } else if (checking) {
    body = "Checking availability…"
  } else if (taken) {
    body = (
      <span className="text-destructive">
        already taken — try another label
      </span>
    )
  } else if (available) {
    body = (
      <span className="text-status-online">
        available — peers can resolve this device by this name
      </span>
    )
  } else {
    body = "Other peers will be able to resolve this device by this name."
  }
  const canReset = touched && defaultPrefix && prefix !== defaultPrefix
  return (
    <p className="text-muted-foreground flex items-center justify-between gap-2 font-mono text-[11px]">
      <span className="min-w-0 truncate">{body}</span>
      {canReset && (
        <button
          type="button"
          onClick={onReset}
          className="hover:text-foreground shrink-0 underline-offset-2 hover:underline"
        >
          reset to default
        </button>
      )}
    </p>
  )
}

function dnsLabelSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)
    .replace(/-$/, "")
}

function isValidDnsPrefix(prefix: string): boolean {
  if (!prefix) return false
  const labelRe = /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/
  return prefix.split(".").every((p) => labelRe.test(p))
}

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

function ipPlaceholderFor(cidr: string): string {
  const range = ipRangeFromCidr(cidr)
  if (!range) return "10.42.0.42"
  const slash = cidr.indexOf("/")
  const prefix = slash > 0 ? parseInt(cidr.slice(slash + 1), 10) : 32
  if (prefix <= 24) {
    const parts = range.first.split(".")
    return `${parts[0]}.${parts[1]}.${parts[2]}.42`
  }
  return range.first
}

function ipOutsideCidrReason(ip: string, cidr: string): string | null {
  const slash = cidr.indexOf("/")
  if (slash < 0) return null
  const net = cidr.slice(0, slash)
  const prefix = parseInt(cidr.slice(slash + 1), 10)
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null
  const netParts = net.split(".").map(Number)
  const ipParts = ip.split(".").map(Number)
  if (netParts.length !== 4 || ipParts.length !== 4) return null
  const netU32 =
    ((netParts[0] << 24) | (netParts[1] << 16) | (netParts[2] << 8) | netParts[3]) >>> 0
  const ipU32 =
    ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0
  const total = 2 ** (32 - prefix)
  const mask = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0
  const baseU32 = (netU32 & mask) >>> 0
  const broadcastU32 = (baseU32 + total - 1) >>> 0
  if (ipU32 < baseU32 || ipU32 > broadcastU32) {
    return `outside ${cidr}`
  }
  if (total >= 4) {
    if (ipU32 === baseU32) return "network address (reserved)"
    if (ipU32 === broadcastU32) return "broadcast address (reserved)"
    if (ipU32 === ((baseU32 + 1) >>> 0)) return "gateway address (reserved)"
  }
  return null
}

/** Compute the usable IPv4 address range for a CIDR — excluding the
 *  network address, the gateway slot (.1, which the server reserves),
 *  and the broadcast address. Returns null for malformed input or subnets
 *  too small to host anything (≤ /30). */
function ipRangeFromCidr(cidr: string): {
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
  const firstU32 = (base + 2) >>> 0
  const lastU32 = (base + total - 2) >>> 0
  const u32ToIp = (n: number) =>
    `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`
  return { first: u32ToIp(firstU32), last: u32ToIp(lastU32), total: total - 3 }
}
