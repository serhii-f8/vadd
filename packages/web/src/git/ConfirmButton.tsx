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
  tone = 'destructive',
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  /**
   * How much the armed state should shout.
   *
   * Defaults to `destructive`, which is right for almost every control here —
   * they rewrite history, delete branches, or remove directories. But not all
   * of them: releasing a `vanished` stray clears a database record and touches
   * no file at all, and until this existed it armed in exactly the same red as
   * the control that deletes a directory recursively. Seen side by side in a
   * browser on 2026-08-25: the words differed, the signal did not, and the
   * whole point of separating the two kinds is that they cost different
   * things. A warning that fires identically for a harmless action is how a
   * user learns to click through the dangerous one.
   */
  tone?: 'destructive' | 'caution'
}) {
  const [armed, setArmed] = useState(false)

  return (
    <Button
      type="button"
      variant={armed ? (tone === 'destructive' ? 'destructive' : 'secondary') : 'outline'}
      size="sm"
      disabled={disabled}
      /*
        The armed label is a whole sentence and can be considerably longer than
        the resting one — for a path it is unbounded. `Button`'s own styles
        keep text on one line at a fixed height, which meant an armed label
        simply ran off the right edge of the window: seen in a real browser on
        2026-08-25, the stray-worktree delete confirm was cut off mid-path,
        with neither the directory being deleted nor the words "and everything
        in it?" readable at the moment of the destructive second click. Worse,
        the growing button squeezed the row's own path down to nothing, so the
        identity of the target vanished exactly when it mattered.

        Wrapping instead of overflowing is the fix, and it belongs here rather
        than at one call site: every confirm control in the git console — Pass
        B's rewrites, Pass C's push labels — carries the same unbounded
        sentence and the same latent bug.
      */
      className="h-auto max-w-full whitespace-normal py-1 text-left leading-snug"
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
