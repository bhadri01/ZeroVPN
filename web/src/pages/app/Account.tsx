import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Panel, Pill } from "@/components/swiss"
import { Button } from "@/components/ui/button"
import { ApiError, deleteAccount } from "@/lib/api"
import { useAuth } from "@/stores/auth"

/** Account-management content embedded by the unified `/app/settings`
 *  page (Account tab). Owns the profile readout, data-export panel, and
 *  the account-deletion lifecycle. */
export function AccountSections() {
  const navigate = useNavigate()
  const reset = useAuth((s) => s.reset)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

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
    <AccountSectionsBody
      deleteOpen={deleteOpen}
      setDeleteOpen={setDeleteOpen}
      deleting={deleting}
      handleDelete={handleDelete}
    />
  )
}

function AccountSectionsBody({
  deleteOpen,
  setDeleteOpen,
  deleting,
  handleDelete,
}: {
  deleteOpen: boolean
  setDeleteOpen: (open: boolean) => void
  deleting: boolean
  handleDelete: () => Promise<void>
}) {
  const user = useAuth((s) => s.user)
  return (
    <div className="flex flex-col gap-6">
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
