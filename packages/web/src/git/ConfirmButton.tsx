import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * A destructive control that takes a second, confirming click.
 *
 * The plan asked for this to "match `AbandonButton`'s existing two-click
 * pattern rather than introducing a modal" — but `AbandonButton` is a modal
 * `Dialog`, so there was no two-click pattern in the codebase to match. The
 * design's own §9 says "rather than introducing a modal", and the plan's own
 * tests describe a label swap and a blur revert, so an inline two-click
 * button is what both actually specify. It is also the right shape here for a
 * reason a modal is not: the `/git` console puts one of these on every
 * worktree, branch and commit row, and a modal per row would be a wall of
 * dialogs.
 *
 * `confirmLabel` names what will happen, not "Are you sure?" — for a rewrite
 * it names how many checkpoints will be nulled, which is the one thing the
 * user cannot recover by reading the screen afterwards.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)

  return (
    <Button
      type="button"
      variant={armed ? 'destructive' : 'outline'}
      size="sm"
      disabled={disabled}
      // Disarms when the control loses focus. A button left armed fires on a
      // click the user believed was their first.
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  )
}
