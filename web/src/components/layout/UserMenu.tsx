import {
  IconLogout,
  IconShield,
  IconUser,
} from "@tabler/icons-react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { logout as apiLogout } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function UserMenu() {
  const user = useAuth((s) => s.user)
  const reset = useAuth((s) => s.reset)

  const handleLogout = async () => {
    try {
      await apiLogout()
    } catch {
      /* ignore network failure — UI must still drop session */
    }
    reset()
  }

  if (!user) return null

  const initial = user.email[0]?.toUpperCase() ?? "?"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-none"
          aria-label={`Open user menu for ${user.email}`}
        >
          <span className="bg-muted text-muted-foreground border-border flex size-7 items-center justify-center border font-mono text-[11px] font-medium uppercase">
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>
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
          <Link to="/app/account">
            <IconUser />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/app/security">
            <IconShield />
            Security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleLogout()}>
          <IconLogout />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
