/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

type Theme = "dark" | "light" | "system"
type ResolvedTheme = "dark" | "light"
export type Accent = "lime" | "cobalt" | "orange" | "magenta" | "ink"
/** Visual theme variant. Orthogonal to the light/dark mode toggle —
 *  picks the entire visual language (palette + radius + font + spacing).
 *  Each variant ships a light + dark token set in index.css. */
export type ThemeVariant =
  | "swiss"
  | "brutalist"
  | "terminal"
  | "editorial"
  | "soft"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  accentStorageKey?: string
  variantStorageKey?: string
  chartRxStorageKey?: string
  chartTxStorageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  accent: Accent
  setAccent: (accent: Accent) => void
  variant: ThemeVariant
  setVariant: (variant: ThemeVariant) => void
  // Chart line colors. A hex string, or the literal "accent" (= follow the
  // accent / --primary). Applied as --chart-rx / --chart-tx on <html>.
  rxColor: string
  setRxColor: (color: string) => void
  txColor: string
  setTxColor: (color: string) => void
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const THEME_VALUES: Theme[] = ["dark", "light", "system"]
const ACCENT_VALUES: Accent[] = ["lime", "cobalt", "orange", "magenta", "ink"]
const VARIANT_VALUES: ThemeVariant[] = [
  "swiss",
  "brutalist",
  "terminal",
  "editorial",
  "soft",
]

function isAccent(value: string | null): value is Accent {
  if (value === null) return false
  return ACCENT_VALUES.includes(value as Accent)
}

function isVariant(value: string | null): value is ThemeVariant {
  if (value === null) return false
  return VARIANT_VALUES.includes(value as ThemeVariant)
}

const ThemeProviderContext = React.createContext<
  ThemeProviderState | undefined
>(undefined)

function isTheme(value: string | null): value is Theme {
  if (value === null) {
    return false
  }

  return THEME_VALUES.includes(value as Theme)
}

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia(COLOR_SCHEME_QUERY).matches) {
    return "dark"
  }

  return "light"
}

function disableTransitionsTemporarily() {
  const style = document.createElement("style")
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
    )
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        style.remove()
      })
    })
  }
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const editableParent = target.closest(
    "input, textarea, select, [contenteditable='true']"
  )
  if (editableParent) {
    return true
  }

  return false
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "zerovpn-theme",
  accentStorageKey = "zerovpn-accent",
  variantStorageKey = "zerovpn-theme-variant",
  chartRxStorageKey = "zerovpn-chart-rx",
  chartTxStorageKey = "zerovpn-chart-tx",
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [resolvedTheme, setResolvedTheme] =
    React.useState<ResolvedTheme>("light")

  const [theme, setThemeState] = React.useState<Theme>(() => {
    const storedTheme = localStorage.getItem(storageKey)
    if (isTheme(storedTheme)) {
      return storedTheme
    }

    return defaultTheme
  })

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      localStorage.setItem(storageKey, nextTheme)
      setThemeState(nextTheme)
    },
    [storageKey]
  )

  // Accent variant — applied to <html> as `data-accent="..."`. index.css
  // attaches per-variant overrides for `--primary` / `--primary-foreground`
  // / `--ring` so every shadcn primitive picks up the new tint without
  // touching its own classes.
  const [accent, setAccentState] = React.useState<Accent>(() => {
    const stored = localStorage.getItem(accentStorageKey)
    return isAccent(stored) ? stored : "lime"
  })
  const setAccent = React.useCallback(
    (next: Accent) => {
      localStorage.setItem(accentStorageKey, next)
      setAccentState(next)
    },
    [accentStorageKey]
  )
  React.useEffect(() => {
    document.documentElement.setAttribute("data-accent", accent)
  }, [accent])

  // Theme variant — applied to <html> as `data-theme="..."`. index.css
  // attaches per-variant overrides for the full color/radius/font/density
  // family so swapping the attribute repaints the entire app without a
  // remount. Persisted to localStorage for instant first-paint; the
  // server-synced value (user prefs) overwrites it via setVariant once
  // /me/preferences resolves, so the user's choice follows them across
  // devices. Default "swiss" preserves the current look for new users.
  const [variant, setVariantState] = React.useState<ThemeVariant>(() => {
    const stored = localStorage.getItem(variantStorageKey)
    return isVariant(stored) ? stored : "swiss"
  })
  const setVariant = React.useCallback(
    (next: ThemeVariant) => {
      localStorage.setItem(variantStorageKey, next)
      setVariantState(next)
    },
    [variantStorageKey],
  )
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", variant)
  }, [variant])

  // Chart line colors (RX/TX) — user-selectable, applied as CSS vars on
  // <html> so every chart (var(--chart-rx)/var(--chart-tx)) picks them up.
  // The literal "accent" means "follow the accent" -> var(--primary).
  const [rxColor, setRxColorState] = React.useState<string>(
    () => localStorage.getItem(chartRxStorageKey) || "#3D5BFF"
  )
  const [txColor, setTxColorState] = React.useState<string>(
    () => localStorage.getItem(chartTxStorageKey) || "accent"
  )
  const setRxColor = React.useCallback(
    (next: string) => {
      localStorage.setItem(chartRxStorageKey, next)
      setRxColorState(next)
    },
    [chartRxStorageKey]
  )
  const setTxColor = React.useCallback(
    (next: string) => {
      localStorage.setItem(chartTxStorageKey, next)
      setTxColorState(next)
    },
    [chartTxStorageKey]
  )
  React.useEffect(() => {
    document.documentElement.style.setProperty(
      "--chart-rx",
      rxColor === "accent" ? "var(--primary)" : rxColor
    )
  }, [rxColor])
  React.useEffect(() => {
    document.documentElement.style.setProperty(
      "--chart-tx",
      txColor === "accent" ? "var(--primary)" : txColor
    )
  }, [txColor])

  const applyTheme = React.useCallback(
    (nextTheme: Theme) => {
      const root = document.documentElement
      const resolvedTheme =
        nextTheme === "system" ? getSystemTheme() : nextTheme
      const restoreTransitions = disableTransitionOnChange
        ? disableTransitionsTemporarily()
        : null

      root.classList.remove("light", "dark")
      root.classList.add(resolvedTheme)
      root.style.colorScheme = resolvedTheme
      setResolvedTheme(resolvedTheme)

      if (restoreTransitions) {
        restoreTransitions()
      }
    },
    [disableTransitionOnChange]
  )

  React.useEffect(() => {
    applyTheme(theme)

    if (theme !== "system") {
      return undefined
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => {
      applyTheme("system")
    }

    mediaQuery.addEventListener("change", handleChange)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [theme, applyTheme])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      setThemeState((currentTheme) => {
        const nextTheme =
          currentTheme === "dark"
            ? "light"
            : currentTheme === "light"
              ? "dark"
              : getSystemTheme() === "dark"
                ? "light"
                : "dark"

        localStorage.setItem(storageKey, nextTheme)
        return nextTheme
      })
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [storageKey])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) {
        return
      }

      if (event.key !== storageKey) {
        return
      }

      if (isTheme(event.newValue)) {
        setThemeState(event.newValue)
        return
      }

      setThemeState(defaultTheme)
    }

    window.addEventListener("storage", handleStorageChange)

    return () => {
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [defaultTheme, storageKey])

  const value = React.useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      accent,
      setAccent,
      variant,
      setVariant,
      rxColor,
      setRxColor,
      txColor,
      setTxColor,
    }),
    [
      theme,
      resolvedTheme,
      setTheme,
      accent,
      setAccent,
      variant,
      setVariant,
      rxColor,
      setRxColor,
      txColor,
      setTxColor,
    ]
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
