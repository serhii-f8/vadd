import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { api } from '../api.js'
import { ConfirmButton } from '../git/ConfirmButton.js'
import { UndoBanner } from '../git/UndoBanner.js'

/**
 * Amendment A19's Focus View subset: stage everything, commit, and undo, for
 * the current objective only.
 *
 * Deliberately not the console. Spec §8 fixes one primary element per state,
 * and the Focus View is not becoming a git client — Pass A's branch strip
 * already links through to `/git` for branches, worktrees and history.
 *
 * The busy set is duplicated here rather than imported from the server's
 * `mutation-gate.ts` on purpose: `packages/web` importing a server module
 * would reach a `node:` builtin through the same barrel that made the
 * Decision Card unreachable in a real browser while jsdom stayed green. The
 * server remains the guard — this only decides what to *offer*, and a stale
 * copy costs a 409 the strip already knows how to render, not an ungated
 * mutation.
 */
const BUSY: Record<string, string> = {
  creating: 'setup commands are installing dependencies',
  executing: 'the agent is editing files',
  revising: 'the agent is editing files',
  verifying: 'the verification suite is running',
  rollingBack: 'a rollback is resetting this worktree',
  integrating: 'integration is committing and removing this worktree',
}

export function GitStrip({
  projectId,
  worktreePath,
  status,
  undoable,
  onDone,
}: {
  projectId: string
  worktreePath: string
  status: string
  /** What the last mutation here would restore, or null for no record. */
  undoable: string | null
  /**
   * Called after every attempt with what an undo would now restore — null
   * after an undo itself, since undo is one step deep and there is nothing
   * further back to offer.
   */
  onDone: (undoable: string | null) => void
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blockedBy = BUSY[status]
  if (blockedBy !== undefined) {
    return (
      <Alert>
        <AlertDescription>
          Git changes are unavailable while {status}: {blockedBy}. Pause the objective first.
        </AlertDescription>
      </Alert>
    )
  }

  const run = async (op: string, body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    let next: string | null = undoable
    try {
      const { report } = await api.gitMutate(projectId, op, { worktree: worktreePath, ...body })
      next = op === 'undo' ? null : report.describes
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
    onDone(next)
  }

  return (
    <div className="flex flex-col gap-2">
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Commit message"
          placeholder="Commit message"
          className="max-w-xs"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <ConfirmButton
          label="Stage everything"
          confirmLabel="Stage all changes here?"
          disabled={busy}
          onConfirm={() => void run('stage', { paths: ['.'] })}
        />
        <ConfirmButton
          label="Commit staged"
          confirmLabel={`Commit as “${message || 'no message'}”?`}
          disabled={busy || message.trim() === ''}
          onConfirm={() => void run('commit', { message })}
        />
      </div>
      <UndoBanner describes={undoable} busy={busy} onUndo={() => void run('undo', {})} />
    </div>
  )
}
