import { eq } from 'drizzle-orm'
import { execa } from 'execa'
import type { Db } from '../db/client.js'
import { objectives, type projects } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { removeWorktree } from '../git/git-manager.js'

export type IntegrateAction = 'commit' | 'keep' | 'discard'

export type IntegrateOutcome = { ok: true; committed: boolean } | { ok: false; message: string }

type Deps = { db: Db; bus: EventBus }
type ObjectiveRow = typeof objectives.$inferSelect
type ProjectRow = typeof projects.$inferSelect

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', ['-C', cwd, ...args])
  return stdout
}

/**
 * Spec §7's `integrate`, with real mechanics (design §6.1).
 *
 * Called from the route *between* the machine's `can(INTEGRATE)` check and the
 * `send`, never from the machine action: the action is synchronous and git is
 * not, and firing this and forgetting it would let `done` be reached before the
 * worktree was dealt with — an objective marked proven whose work was never
 * landed, which is the exact lie spec §5's guard exists to prevent.
 *
 * Returns rather than throws so the caller can leave the objective in
 * `integrating` and let the user retry. Nothing here is idempotent by halves:
 * each action either completes or leaves the worktree untouched.
 */
export async function runIntegration(
  deps: Deps,
  objective: ObjectiveRow,
  project: ProjectRow,
  action: IntegrateAction,
): Promise<IntegrateOutcome> {
  if (action === 'keep') {
    // Nothing to do, and saying so explicitly matters: `keep` is the action a
    // user picks to go on working in the worktree by hand.
    deps.bus.emit({ objectiveId: objective.id, type: 'integrate_kept', payload: {} })
    return { ok: true, committed: false }
  }

  const { worktreePath, branchName } = objective
  if (!worktreePath || !branchName) {
    // Already integrated, or discarded, or never got a worktree. Not an error:
    // there is simply no git work left to do.
    return { ok: true, committed: false }
  }

  if (action === 'discard') {
    try {
      await removeWorktree(project.repoPath, worktreePath, branchName)
    } catch (err) {
      const message = errorMessage(err)
      deps.bus.emit({ objectiveId: objective.id, type: 'integrate_failed', payload: { message } })
      return { ok: false, message }
    }
    deps.db
      .update(objectives)
      .set({ worktreePath: null, branchName: null, updatedAt: new Date().toISOString() })
      .where(eq(objectives.id, objective.id))
      .run()
    deps.bus.emit({ objectiveId: objective.id, type: 'integrate_discarded', payload: {} })
    return { ok: true, committed: false }
  }

  // action === 'commit'
  const baseSha = objective.baseSha
  if (!baseSha) {
    const message =
      'Objective has no baseSha, so its checkpoints cannot be squashed. ' +
      'Objectives created before amendment A8 must be integrated with "keep".'
    deps.bus.emit({ objectiveId: objective.id, type: 'integrate_failed', payload: { message } })
    return { ok: false, message }
  }

  let committed = false
  try {
    // Stage the working tree first, then move HEAD back. `reset --soft` leaves
    // index and working tree alone, so after this the index holds the whole
    // final tree and one commit carries the entire change — the
    // `vadd-checkpoint:` commits collapse into it.
    await git(worktreePath, ['add', '-A'])
    await git(worktreePath, ['reset', '--soft', baseSha])

    const empty = await execa('git', ['-C', worktreePath, 'diff', '--cached', '--quiet'], {
      reject: false,
    })
    // `--quiet` exits 1 when there *are* staged changes, 0 when there are none.
    if (empty.exitCode === 0) {
      // An objective proven green by `checks` alone legitimately has no diff.
      deps.bus.emit({ objectiveId: objective.id, type: 'integrate_empty', payload: {} })
    } else {
      const message = `${objective.title}\n\n${objective.goalText}`
      await git(worktreePath, ['commit', '-m', message])
      committed = true
    }

    // null keeps the branch: the user merges it however they already merge
    // things. `pr` and `merge` are M2.
    await removeWorktree(project.repoPath, worktreePath, null)
  } catch (err) {
    const message = errorMessage(err)
    deps.bus.emit({ objectiveId: objective.id, type: 'integrate_failed', payload: { message } })
    return { ok: false, message }
  }

  deps.db
    .update(objectives)
    .set({ worktreePath: null, updatedAt: new Date().toISOString() })
    .where(eq(objectives.id, objective.id))
    .run()
  deps.bus.emit({ objectiveId: objective.id, type: 'integrate_committed', payload: { committed } })
  return { ok: true, committed }
}
