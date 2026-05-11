import { IconDownload } from "@tabler/icons-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PageHead, Panel, Pill } from "@/components/swiss"
import { Button } from "@/components/ui/button"
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
    <div className="flex flex-col gap-6">
      <PageHead
        eyebrow="Account · 06"
        title="Account"
        sub="profile · data · lifecycle"
      />

      <Panel title="Profile">
        <div className="flex flex-col gap-3 text-sm">
          <Row label="Email">
            <span className="font-medium">{user?.email}</span>
          </Row>
          <Row label="Role">
            {user?.role === "admin" ? (
              <Pill tone="info">admin</Pill>
            ) : (
              <span className="text-muted-foreground capitalize">
                {user?.role}
              </span>
            )}
          </Row>
        </div>
      </Panel>

      <Panel
        title="Data export"
        sub="GDPR-shaped · ndjson"
      >
        <p className="text-muted-foreground max-w-[60ch] text-[13px] leading-relaxed">
          Download a JSON copy of everything we hold for {user?.email}: account
          metadata, devices, and audit-log entries you originated. Password
          hashes, TOTP secrets, and other sensitive fields are excluded.
        </p>
        <div className="mt-3">
          <Button onClick={handleExport} disabled={exporting}>
            <IconDownload />
            {exporting ? "Preparing…" : "Download data export"}
          </Button>
        </div>
      </Panel>

      <Panel
        title="Delete account"
        sub="soft-delete · 30-day grace period"
        className="border-destructive/40"
      >
        <p className="text-destructive max-w-[60ch] text-[13px] leading-relaxed">
          Soft-deletes your account, revokes every device + session, nulls
          personally-identifying fields, and signs you out. Reversible by an
          administrator within 30 days; after that, the row is hard-purged.
        </p>
        <div className="mt-3">
          <Button
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </Button>
        </div>
      </Panel>

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

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
      <span className="zv-eyebrow self-center">{label}</span>
      <span className="self-center">{children}</span>
    </div>
  )
}
