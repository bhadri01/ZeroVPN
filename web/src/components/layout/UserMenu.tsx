import {
  IconLogout,
  IconSettings,
  IconShield,
  IconUser,
  IconUserX,
} from "@tabler/icons-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Identicon } from "@/components/Identicon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { adminStopImpersonation, logout as apiLogout, me } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function UserMenu() {
  const user = useAuth((s) => s.user)
  const reset = useAuth((s) => s.reset)
  const setUser = useAuth((s) => s.setUser)
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [stopImpersonationConfirmOpen, setStopImpersonationConfirmOpen] =
    useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [stoppingImpersonation, setStoppingImpersonation] = useState(false)
  // Suppress the avatar's hover tooltip while the dropdown is open so
  // the two floating elements don't visually collide.
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = async () => {
    setSigningOut(true)
    try {
      await apiLogout()
    } catch {
      /* ignore network failure — UI must still drop session */
    }
    setSigningOut(false)
    setConfirmOpen(false)
    reset()
  }

  const handleStopImpersonation = async () => {
    setStoppingImpersonation(true)
    try {
      await adminStopImpersonation()
      const updated = await me()
      setUser(updated)
      toast.success("Returned to your admin session")
      void navigate("/admin/users")
    } catch {
      toast.error("Failed to stop impersonation")
    } finally {
      setStoppingImpersonation(false)
    }
  }

  if (!user) return null

  return (
    <>
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip open={menuOpen ? false : undefined}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-none"
              aria-label={`Open user menu for ${user.email}`}
            >
              <span className={`flex size-7 items-center justify-center border p-0.5 ${user.is_impersonated ? "border-amber-500/60 bg-amber-500/10" : "border-border bg-card"}`}>
                <Identicon seed={user.email} size={24} cells={5} />
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{user.email}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="font-normal">
          <p className="text-foreground truncate text-sm font-medium">
            {user.email}
          </p>
          <p className="text-muted-foreground capitalize text-xs">
            {user.is_impersonated ? (
              <span className="text-amber-600 dark:text-amber-400">impersonated session</span>
            ) : (
              user.role
            )}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.is_impersonated ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setMenuOpen(false)
              setStopImpersonationConfirmOpen(true)
            }}
            disabled={stoppingImpersonation}
            className="text-amber-700 dark:text-amber-400 focus:text-amber-700 dark:focus:text-amber-400"
          >
            <IconUserX />
            {stoppingImpersonation ? "Stopping…" : "Exit impersonation"}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem asChild>
              <Link to="/app/settings">
                <IconSettings />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/app/settings#account">
                <IconUser />
                Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/app/settings#security">
                <IconShield />
                Security
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setConfirmOpen(true)
              }}
            >
              <IconLogout />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>

    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="Sign out?"
      description="You'll need to sign in again to access your dashboard."
      confirmLabel="Sign out"
      cancelLabel="Stay signed in"
      destructive
      pending={signingOut}
      onConfirm={() => void handleLogout()}
    />

    <ConfirmDialog
      open={stopImpersonationConfirmOpen}
      onOpenChange={setStopImpersonationConfirmOpen}
      title="Exit impersonation?"
      description="You'll return to your admin session and leave this user's view."
      confirmLabel="Exit impersonation"
      cancelLabel="Keep impersonating"
      pending={stoppingImpersonation}
      onConfirm={() => void handleStopImpersonation()}
    />
    </>
  )
}
