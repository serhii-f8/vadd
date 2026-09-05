import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * A9's `abandon` is terminal — it removes the worktree and the objective can
 * never be resumed. It fired on a single unconfirmed click until A17. Pause
 * and Low Energy are deliberately *not* given this treatment: they are
 * reversible.
 *
 * The dialog is its own component so the header's overflow menu can open it:
 * a dialog rendered inside a dropdown's content unmounts with the menu.
 */
export function AbandonDialog({
  open,
  onOpenChange,
  title,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abandon “{title}”?</DialogTitle>
          <DialogDescription>
            The worktree is removed and this objective cannot be resumed. Its evidence is kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep working
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            Abandon objective
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AbandonButton({ title, onConfirm }: { title: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Abandon
      </Button>
      <AbandonDialog open={open} onOpenChange={setOpen} title={title} onConfirm={onConfirm} />
    </>
  )
}
