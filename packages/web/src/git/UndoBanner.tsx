import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * The one-step way back from the last mutation on this worktree.
 *
 * Renders nothing when there is no record — undo is one step deep, so a
 * further mutation replaces the record and the banner then describes the new
 * one rather than the old.
 *
 * Both of the design's honest limits are stated here rather than left to be
 * discovered: `reset --hard` restores the commit graph and leaves untracked
 * files alone, and the record is a pointer into git's reflog, not a backup.
 */
export function UndoBanner({
  describes,
  onUndo,
  busy,
}: {
  describes: string | null
  onUndo: () => void
  busy?: boolean
}) {
  if (describes === null) return null

  return (
    <Alert>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Last git change here: <strong>{describes}</strong>. Undo restores the commit graph only —
          untracked files it removed are not brought back.
        </span>
        <Button variant="outline" size="sm" disabled={busy} onClick={onUndo}>
          Undo
        </Button>
      </AlertDescription>
    </Alert>
  )
}
