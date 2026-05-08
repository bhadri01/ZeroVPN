import { IconDownload } from "@tabler/icons-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ApiError, deleteAccount, exportData } from "@/lib/api"
import { useAuth } from "@/stores/auth"

export function AccountPage() {
  const navigate = useNavigate()
  const reset = useAuth((s) => s.reset)
  const user = useAuth((s) => s.user)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

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
      a.download = `zerovpn-data-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json`
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
    <div className="space-y-6">
      <PageHeader
        title="Account"
        description="Profile, data export, and account deletion."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Account email and role.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium">{user?.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd className="capitalize">{user?.role}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your data</CardTitle>
          <CardDescription>
            Download a JSON copy of everything we hold for {user?.email}:
            account metadata, devices, and audit-log entries you originated.
            Password hashes, TOTP secrets, and other sensitive fields are
            excluded.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={handleExport} disabled={exporting}>
            <IconDownload />
            {exporting ? "Preparing…" : "Download data export"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive text-base">
            Delete account
          </CardTitle>
          <CardDescription>
            Soft-deletes your account, revokes every device + session, nulls
            personally-identifying fields, and signs you out. Reversible by
            an administrator within 30 days; after that, the row is
            hard-purged.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete account?"
        description={`This soft-deletes ${user?.email}, revokes every device, and signs you out everywhere. Reversible by an admin within 30 days.`}
        confirmText={user?.email}
        confirmLabel="Delete account"
        destructive
        pending={deleting}
        onConfirm={() => {
          setDeleteOpen(false)
          void handleDelete()
        }}
      />
    </div>
  )
}
