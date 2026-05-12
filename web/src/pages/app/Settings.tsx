import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconBell,
  IconCheck,
  IconKey,
  IconPalette,
  IconSettings,
  IconShield,
  IconUser,
  type Icon,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { toast } from "sonner"

import { FadeIn, PageStagger, StaggerItem } from "@/components/motion"
import { useTheme, type Accent } from "@/components/theme-provider"
import { Eyebrow, PageHead, Panel, Seg } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ApiError,
  getMyPreferences,
  setMyPreferences,
  type DateFormatPref,
  type DefaultLandingPref,
  type TimeFormatPref,
  type ToastPositionPref,
  type UnitsPref,
  type UserPreferences,
} from "@/lib/api"
import { notify } from "@/lib/notify"
import { AccountSections } from "@/pages/app/Account"
import { SecuritySections } from "@/pages/app/Security"

// ── Sub-nav model ─────────────────────────────────────────────────────
type SectionKey =
  | "appearance"
  | "preferences"
  | "notifications"
  | "account"
  | "security"

interface SectionDef {
  key: SectionKey
  label: string
  hash: string
  icon: Icon
  hint: string
}

const SECTIONS: SectionDef[] = [
  {
    key: "appearance",
    label: "Appearance",
    hash: "appearance",
    icon: IconPalette,
    hint: "Theme, accent color",
  },
  {
    key: "preferences",
    label: "Preferences",
    hash: "preferences",
    icon: IconSettings,
    hint: "Units, dates, defaults",
  },
  {
    key: "notifications",
    label: "Notifications",
    hash: "notifications",
    icon: IconBell,
    hint: "Toasts, browser alerts",
  },
  {
    key: "account",
    label: "Account",
    hash: "account",
    icon: IconUser,
    hint: "Profile, data, lifecycle",
  },
  {
    key: "security",
    label: "Security",
    hash: "security",
    icon: IconShield,
    hint: "2FA, password, codes",
  },
]

const HASH_TO_KEY: Record<string, SectionKey> = Object.fromEntries(
  SECTIONS.map((s) => [s.hash, s.key]),
) as Record<string, SectionKey>

const ACCENT_SWATCHES: { value: Accent; label: string; preview: string }[] = [
  { value: "lime", label: "Lime", preview: "#C6FF3D" },
  { value: "cobalt", label: "Cobalt", preview: "#3D5BFF" },
  { value: "orange", label: "Orange", preview: "#FF6A1F" },
  { value: "magenta", label: "Magenta", preview: "#FF2E88" },
  { value: "ink", label: "Ink", preview: "#0A0A0A" },
]

export function SettingsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  // Tracks the active section. Synced to URL hash so deep links (e.g.
  // /app/settings#appearance) and back/forward navigation work.
  const initialFromHash = HASH_TO_KEY[location.hash.replace(/^#/, "")]
  const [active, setActive] = useState<SectionKey>(initialFromHash ?? "appearance")

  useEffect(() => {
    const next = HASH_TO_KEY[location.hash.replace(/^#/, "")]
    if (next && next !== active) setActive(next)
  }, [location.hash, active])

  const selectSection = (key: SectionKey) => {
    const def = SECTIONS.find((s) => s.key === key)
    if (!def) return
    setActive(key)
    navigate(`/app/settings#${def.hash}`, { replace: false })
  }

  const activeDef = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0]

  return (
    <PageStagger>
      <StaggerItem>
        <PageHead
          eyebrow="Workspace · 07"
          title="Settings"
          sub="Profile, appearance, and account-wide preferences."
        />
      </StaggerItem>

      <StaggerItem className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Sub-nav — vertical on desktop. Each row is the section label
            + a one-liner hint so the page is self-documenting. */}
        <aside className="border-border lg:sticky lg:top-6 lg:self-start lg:border">
          <ul className="divide-border lg:divide-y">
            {SECTIONS.map((s) => {
              const isActive = s.key === active
              const I = s.icon
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => selectSection(s.key)}
                    data-active={isActive ? "1" : undefined}
                    className={[
                      "zv-settings-nav-item w-full",
                      isActive && "zv-settings-nav-item--on",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <I size={14} className="text-muted-foreground shrink-0" />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="text-foreground block text-[13px] font-medium">
                        {s.label}
                      </span>
                      <span className="text-muted-foreground/80 block font-mono text-[10px]">
                        {s.hint}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <section className="flex flex-col gap-6">
          <div>
            <Eyebrow>{activeDef.label}</Eyebrow>
            <h2 className="font-heading text-foreground mt-1 text-xl font-medium tracking-[-0.01em]">
              {activeDef.hint}
            </h2>
          </div>

          <FadeIn key={active}>
            {active === "appearance" && <AppearanceSection />}
            {active === "preferences" && <PreferencesSection />}
            {active === "notifications" && <NotificationsSection />}
            {active === "account" && <AccountSections />}
            {active === "security" && <SecuritySections />}
          </FadeIn>
        </section>
      </StaggerItem>
    </PageStagger>
  )
}

// ── Appearance ────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme, accent, setAccent } = useTheme()
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Theme" sub="Light, dark, or follow the OS">
        <Seg
          value={theme}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
          onChange={setTheme}
        />
        <p className="text-muted-foreground mt-3 font-mono text-[11px]">
          Press <span className="zv-kbd">D</span> anywhere outside an input
          to toggle light/dark instantly.
        </p>
      </Panel>

      <Panel
        title="Accent color"
        sub="Tints buttons, links, focus rings, and the live-throughput series"
      >
        <div className="flex flex-wrap gap-2">
          {ACCENT_SWATCHES.map((opt) => {
            const isActive = opt.value === accent
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAccent(opt.value)}
                className={[
                  "zv-accent-swatch",
                  isActive && "zv-accent-swatch--on",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={isActive}
                aria-label={opt.label}
                title={opt.label}
              >
                <span
                  className="zv-accent-swatch__chip"
                  style={{ background: opt.preview }}
                  aria-hidden
                >
                  {isActive && <IconCheck size={12} strokeWidth={3} />}
                </span>
                <span className="text-foreground/90 font-mono text-[11px]">
                  {opt.label}
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-muted-foreground mt-3 font-mono text-[11px]">
          Stored locally per browser. Switching takes effect immediately
          without reloading.
        </p>
      </Panel>
    </div>
  )
}

// ── Preferences ───────────────────────────────────────────────────────

function PreferencesSection() {
  const qc = useQueryClient()
  const prefsQ = useQuery({
    queryKey: ["me", "preferences"],
    queryFn: getMyPreferences,
  })
  const m = useMutation({
    mutationFn: (patch: Partial<UserPreferences>) => setMyPreferences(patch),
    onSuccess: (data) => {
      qc.setQueryData(["me", "preferences"], data)
      toast.success("Preferences saved")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  if (prefsQ.isLoading || !prefsQ.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 rounded-none" />
        <Skeleton className="h-32 rounded-none" />
      </div>
    )
  }
  const p = prefsQ.data

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Display"
        sub="How values are formatted across the app"
      >
        <div className="flex flex-col gap-4">
          <PrefRow
            label="Throughput units"
            hint="Bandwidth and live rates"
          >
            <Seg<UnitsPref>
              value={p.units}
              options={[
                { value: "bps", label: "bits/s" },
                { value: "Bps", label: "bytes/s" },
              ]}
              onChange={(v) => m.mutate({ units: v })}
            />
          </PrefRow>
          <PrefRow label="Date format" hint="Tables and exports">
            <Seg<DateFormatPref>
              value={p.date_format}
              options={[
                { value: "iso", label: "ISO" },
                { value: "us", label: "US" },
                { value: "eu", label: "EU" },
              ]}
              onChange={(v) => m.mutate({ date_format: v })}
            />
          </PrefRow>
          <PrefRow label="Time format" hint="Timestamps">
            <Seg<TimeFormatPref>
              value={p.time_format}
              options={[
                { value: "h24", label: "24h" },
                { value: "h12", label: "12h" },
              ]}
              onChange={(v) => m.mutate({ time_format: v })}
            />
          </PrefRow>
        </div>
      </Panel>

      <Panel
        title="Behavior"
        sub="App-wide interaction preferences"
      >
        <div className="flex flex-col gap-4">
          <PrefRow
            label="Default landing"
            hint="Where you start after signing in"
          >
            <Seg<DefaultLandingPref>
              value={p.default_landing}
              options={[
                { value: "dashboard", label: "Dashboard" },
                { value: "devices", label: "Devices" },
                { value: "topology", label: "Topology" },
              ]}
              onChange={(v) => m.mutate({ default_landing: v })}
            />
          </PrefRow>
          <PrefToggle
            label="Reduced motion"
            hint="Suppress animation in topology pulses, page transitions, and chart redraws"
            checked={p.reduced_motion}
            onCheckedChange={(v) => m.mutate({ reduced_motion: v })}
            id="pref-reduced-motion"
          />
        </div>
      </Panel>
    </div>
  )
}

// ── Notifications ─────────────────────────────────────────────────────

function NotificationsSection() {
  const qc = useQueryClient()
  const prefsQ = useQuery({
    queryKey: ["me", "preferences"],
    queryFn: getMyPreferences,
  })
  const m = useMutation({
    mutationFn: (patch: Partial<UserPreferences>) => setMyPreferences(patch),
    onSuccess: (data) => {
      qc.setQueryData(["me", "preferences"], data)
      toast.success("Notifications updated")
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message)
    },
  })

  if (prefsQ.isLoading || !prefsQ.data) {
    return <Skeleton className="h-40 rounded-none" />
  }
  const p = prefsQ.data

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Toasts" sub="Inline confirmation messages">
        <div className="flex flex-col gap-4">
          <PrefRow label="Position" hint="Where toasts appear on screen">
            <Seg<ToastPositionPref>
              value={p.toast_position}
              options={[
                { value: "top-left", label: "Top L" },
                { value: "top-right", label: "Top R" },
                { value: "bottom-left", label: "Bot L" },
                { value: "bottom-right", label: "Bot R" },
              ]}
              onChange={(v) => m.mutate({ toast_position: v })}
            />
          </PrefRow>
          <PrefToggle
            label="Play sound on toast"
            hint="Subtle chime when a toast appears. Off by default."
            checked={p.toast_sound}
            onCheckedChange={(v) => m.mutate({ toast_sound: v })}
            id="pref-toast-sound"
          />
        </div>
      </Panel>

      <Panel
        title="Browser notifications"
        sub="System-level alerts via the Notifications API"
      >
        <PrefToggle
          label="Enable browser notifications"
          hint="One-time browser permission prompt the first time you enable this. We send a notification on key events (device offline / login from new location / admin alerts)."
          checked={p.browser_notifications}
          onCheckedChange={async (v) => {
            if (v && typeof Notification !== "undefined") {
              if (Notification.permission === "default") {
                const r = await Notification.requestPermission()
                if (r !== "granted") {
                  toast.error("Notification permission denied")
                  return
                }
              } else if (Notification.permission === "denied") {
                toast.error(
                  "Notifications are blocked in your browser settings",
                )
                return
              }
            }
            m.mutate({ browser_notifications: v })
          }}
          id="pref-browser-notifications"
        />
      </Panel>

      <Panel title="Test" sub="Fires a sample notification with your current settings">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              notify.info("Test notification", {
                description: "Position, chime, and browser alert reflect your settings.",
                important: true,
                id: "settings-test",
              })
            }
          >
            Send test
          </Button>
          <p className="text-muted-foreground font-mono text-[11px] self-center">
            Hide this tab before clicking to see a browser-level alert.
          </p>
        </div>
      </Panel>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────

function PrefRow({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-foreground text-[13px] font-medium">{label}</div>
        <div className="text-muted-foreground font-mono text-[11px]">
          {hint}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function PrefToggle({
  label,
  hint,
  checked,
  onCheckedChange,
  id,
}: {
  label: string
  hint: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  id: string
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(!!v)}
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <div className="text-foreground text-[13px] font-medium">{label}</div>
        <div className="text-muted-foreground mt-0.5 font-mono text-[11px] leading-relaxed">
          {hint}
        </div>
      </label>
    </div>
  )
}

// Suppress unused-warning for the API tokens icon if a future iteration
// wires it back into the nav. Until then it lives as a reserved export.
export { IconKey as _IconKey }
