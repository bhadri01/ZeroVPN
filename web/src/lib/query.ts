import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Don't retry on auth errors or rate limits
        const e = error as { status?: number }
        if (e.status === 401 || e.status === 403 || e.status === 429) return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: false,
    },
  },
})
