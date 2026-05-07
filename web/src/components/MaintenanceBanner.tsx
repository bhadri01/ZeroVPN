import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"

import { adminGetMaintenance } from "@/lib/api"
import { useAuth } from "@/stores/auth"

/**
 * Polls the maintenance flag once a minute and renders a sticky top banner
 * when ON. The endpoint is admin-only; for non-admin users we don't render
 * anything (they'd just see API errors anyway). The 503 enforcement at the
 * API layer is what actually protects writes.
 */
export function MaintenanceBanner() {
  const user = useAuth((s) => s.user)
  const q = useQuery({
    queryKey: ["maintenance-banner"],
    queryFn: adminGetMaintenance,
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
    retry: false,
  })

  if (!q.data?.maintenance_mode) return null

  return (
    <motion.div
      initial={{ y: -32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="bg-amber-500/15 text-amber-700 dark:text-amber-400 sticky top-0 z-50 border-b border-amber-500/30 px-4 py-2 text-center text-sm"
    >
      <strong>Maintenance mode</strong>
      {q.data.maintenance_message ? ` · ${q.data.maintenance_message}` : ""}
      {" · writes are temporarily blocked for non-admin users."}
    </motion.div>
  )
}
