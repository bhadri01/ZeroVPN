import { Link } from "react-router"

import { Button } from "@/components/ui/button"

export function AdminOverviewPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Admin overview</h1>
        <p className="text-muted-foreground text-sm">
          User management, server config, audit log, full-deployment topology — Phase 1B.
        </p>
        <Button asChild variant="outline">
          <Link to="/">Home</Link>
        </Button>
      </div>
    </div>
  )
}
