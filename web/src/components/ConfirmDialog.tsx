import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Confirmation dialog for destructive actions. For high-risk ops
 * (server key rotation, account deletion), pass `confirmText` and the
 * Confirm button stays disabled until the user types the value exactly.
 *
 * The disabled-to-enabled transition is a 120 ms opacity fade — handled by
 * the Button's own `transition-all`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  ...content
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  confirmText?: string
  onConfirm: () => void
  pending?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Keyed on `open` so each open mounts a fresh body — the typed
          confirmation resets even when the parent closes us programmatically
          (no onOpenChange) after a successful confirm. */}
      <ConfirmDialogBody
        key={String(open)}
        onOpenChange={onOpenChange}
        {...content}
      />
    </Dialog>
  )
}

function ConfirmDialogBody({
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  confirmText,
  onConfirm,
  pending = false,
}: {
  onOpenChange: (next: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  confirmText?: string
  onConfirm: () => void
  pending?: boolean
}) {
  const [typed, setTyped] = useState("")
  const matches = !confirmText || typed.trim() === confirmText.trim()

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>

      {confirmText && (
        <div className="space-y-1.5">
          <Label htmlFor="confirm-text" className="text-xs">
            Type <span className="font-mono">{confirmText}</span> to confirm
          </Label>
          <Input
            id="confirm-text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="font-mono"
          />
        </div>
      )}

      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={pending}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
          disabled={!matches || pending}
          className="transition-opacity"
        >
          {pending ? "…" : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
