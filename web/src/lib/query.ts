import {
  QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"

import { ApiError } from "@/lib/api"

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

/**
 * useOptimisticMutation — pattern for instant UI feedback on a mutation
 * that targets a known query.
 *
 * onMutate cancels in-flight queries, snapshots the cache, and applies the
 * caller's optimistic update synchronously. On error we rollback and toast.
 * onSettled invalidates so the next refetch reconciles with truth.
 */
export function useOptimisticMutation<TVars, TResult, TData>(opts: {
  mutationFn: (vars: TVars) => Promise<TResult>
  queryKey: QueryKey
  update: (old: TData | undefined, vars: TVars) => TData | undefined
  onSuccess?: (result: TResult, vars: TVars) => void
  onError?: (error: unknown, vars: TVars) => void
  errorToast?: boolean
}) {
  const qc = useQueryClient()
  const errorToast = opts.errorToast ?? true

  return useMutation<
    TResult,
    unknown,
    TVars,
    { previous: TData | undefined }
  >({
    mutationFn: opts.mutationFn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: opts.queryKey })
      const previous = qc.getQueryData<TData>(opts.queryKey)
      qc.setQueryData<TData>(opts.queryKey, (old) => opts.update(old, vars))
      return { previous }
    },
    onError: (err, vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(opts.queryKey, ctx.previous)
      }
      if (errorToast) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Something went wrong"
        toast.error(msg)
      }
      opts.onError?.(err, vars)
    },
    onSuccess: opts.onSuccess,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: opts.queryKey })
    },
  })
}
