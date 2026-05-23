import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconLoader,
} from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useTheme } from "@/components/theme-provider"
import { getMyPreferences } from "@/lib/api"
import { setDateTimePrefs } from "@/lib/datetime"
import { setNotifyConfig } from "@/lib/notify"
import { setUnitsPref } from "@/lib/units"

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  // Reflect the user's saved notification preferences into the global
  // toaster (position) and the notify() helper (sound, browser alerts).
  // Logged-out visitors get a single 401 which we don't retry — defaults
  // apply until a session is established. `staleTime` keeps Settings-page
  // mutations live without a manual invalidation, since that mutation
  // writes the same query key.
  const prefsQ = useQuery({
    queryKey: ["me", "preferences"],
    queryFn: getMyPreferences,
    retry: false,
    staleTime: 60_000,
  })

  const position = prefsQ.data?.toast_position ?? "bottom-right"

  useEffect(() => {
    if (!prefsQ.data) return
    setNotifyConfig({
      toastSound: prefsQ.data.toast_sound,
      browserNotifications: prefsQ.data.browser_notifications,
      position: prefsQ.data.toast_position,
    })
    // Apply display-formatting prefs app-wide (units / date / time). The
    // Toaster mounts once near the root and already owns the preferences
    // query, so it doubles as the global preferences applier.
    setUnitsPref(prefsQ.data.units)
    setDateTimePrefs(prefsQ.data.date_format, prefsQ.data.time_format)
  }, [prefsQ.data])

  return (
    <Sonner
      theme={resolvedTheme}
      position={position}
      duration={4000}
      gap={8}
      visibleToasts={5}
      className="toaster group"
      icons={{
        success: <IconCircleCheck className="size-4" />,
        info: <IconInfoCircle className="size-4" />,
        warning: <IconAlertTriangle className="size-4" />,
        error: <IconAlertOctagon className="size-4" />,
        loading: <IconLoader className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
