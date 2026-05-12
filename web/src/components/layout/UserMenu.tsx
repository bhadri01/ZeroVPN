import {
  IconLogout,
  IconSettings,
  IconShield,
  IconUser,
} from "@tabler/icons-react"
import { useState } from "react"
import { Link } from "react-router"

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
import { logout as apiLogout } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function UserMenu() {
  const user = useAuth((s) => s.user)
  const reset = useAuth((s) => s.reset)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
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
              <span className="border-border bg-card flex size-7 items-center justify-center border p-0.5">
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
            {user.role}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
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
    </>
  )
}
