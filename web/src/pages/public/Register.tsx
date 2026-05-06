import { Link } from "react-router"

import { Button } from "@/components/ui/button"

export function RegisterPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Create account</h1>
        <p className="text-muted-foreground text-sm">
          Registration form will be wired in Phase 1A auth task.
        </p>
        <Button asChild variant="outline">
          <Link to="/">Back</Link>
        </Button>
      </div>
    </div>
  )
}
