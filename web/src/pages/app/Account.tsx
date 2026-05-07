import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ApiError, deleteAccount, exportData } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function AccountPage() {
  const navigate = useNavigate()
  const reset = useAuth((s) => s.reset)
  const user = useAuth((s) => s.user)
  const [confirm, setConfirm] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const data = await exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `zerovpn-data-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Data export downloaded")
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteAccount()
      reset()
      toast.warning("Account deleted")
      navigate("/")
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
      setDeleting(false)
    }
  }

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">Account</h1>
        <Button asChild variant="ghost" size="sm">
          <Link to="/app">Back to dashboard</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 p-6">
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Your data</h2>
          <p className="text-muted-foreground text-sm">
            Download a JSON copy of every record we hold for {user?.email}: account
            metadata, devices, and audit-log entries you originated. Excludes
            password hashes, TOTP secrets, and any field marked sensitive.
          </p>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? "Preparing…" : "Download data export"}
          </Button>
        </section>

        <section className="space-y-2 rounded-lg border border-red-500/20 p-4">
          <h2 className="text-xl font-semibold text-red-600 dark:text-red-400">
            Delete account
          </h2>
          <p className="text-sm">
            Soft-deletes your account, revokes every device and session, nulls
            personally-identifying fields (email, password hash, TOTP material),
            and signs you out. Audit entries you originated remain (anonymized
            after the retention window).
          </p>
          <p className="text-muted-foreground text-xs">
            This is reversible only by an administrator within the next 30 days.
            After that, the row is hard-purged.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={`Type "${user?.email ?? "delete"}" to confirm`}
              className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || confirm.trim() !== user?.email}
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}
