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
 * never be resumed. It fired on a single unconfirmed click until now. Pause and
 * Low Energy are deliberately *not* given this treatment: they are reversible.
 */
export function AbandonButton({ title, onConfirm }: { title: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Abandon
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abandon “{title}”?</DialogTitle>
            <DialogDescription>
              The worktree is removed and this objective cannot be resumed. Its evidence is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep working
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              Abandon objective
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
