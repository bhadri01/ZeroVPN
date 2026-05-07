import { create } from "zustand"

import type { PublicUser } from "@/lib/api"

interface AuthState {
  user: PublicUser | null
  loading: boolean
  setUser: (u: PublicUser | null) => void
  setLoading: (l: boolean) => void
  reset: () => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  reset: () => set({ user: null, loading: false }),
}))
