import { create } from "zustand"

import type { PublicUser } from "@/lib/api"

interface AuthState {
  user: PublicUser | null
  loading: boolean
  /** Set by the login response; redirects to /app/change-password until done. */
  mustChangePassword: boolean
  setUser: (u: PublicUser | null) => void
  setLoading: (l: boolean) => void
  setMustChangePassword: (m: boolean) => void
  reset: () => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  mustChangePassword: false,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setMustChangePassword: (mustChangePassword) => set({ mustChangePassword }),
  reset: () =>
    set({ user: null, loading: false, mustChangePassword: false }),
}))
