import { protectedPaths } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { gitUndo, planTasks } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { gateForStatus } from './mutation-gate.js'
import type { Owner } from './provenance.js'
import { gitChecked } from './run.js'

export type MutationKind = {
  /** Rewrites existing commits, so stored checkpoint shas may be invalidated. */
  rewritesHistory: boolean
  /** Produces a commit, so `policy.protectedGlobs` must be applied first. */
  createsCommit: boolean
}

export type MutationTarget = {
  worktreePath: string
  owner: Owner
  /** The objective row when `owner.kind === 'vadd'`; null otherwise. */
  objective: { id: string; status: string; branchName: string | null } | null
  /** Resolved verification spec's protected globs. Empty when none. */
  protectedGlobs: string[]
}

export type MutationReport = {
  describes: string
  /** Paths a `protectedGlobs` rule kept out of a commit. */
  excludedPaths: string[]
  /** Tasks whose `checkpointRef` was nulled by a rewrite. */
  clearedCheckpoints: { taskId: string; ord: number; title: string }[]
}

export type MutationContext = {
  worktreePath: string
  /** HEAD before the operation, or null in a repo with no commits. */
  beforeSha: string | null
  report: MutationReport
}

export type MutationOutcome<T> =
  | { ok: true; result: T; report: MutationReport }
  | { ok: false; status: number; error: string }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** HEAD, or null in a repository with no commits yet. */
async function headSha(worktreePath: string): Promise<string | null> {
  try {
    return (await gitChecked(worktreePath, ['rev-parse', '--verify', 'HEAD'])).trim()
  } catch {
    return null
  }
}

/**
 * Every git mutation goes through here.
 *
 * Fourteen operations share four cross-cutting concerns — the gate, the undo
 * record, `protectedGlobs`, and checkpoint repair — and this codebase's whole
 * defect history is a rule applied in one place and not another
 * (`protectedGlobs` enforced only in the squash; a guard pinned by a test a
 * different code path also satisfied; `rails` computed by a layer the
 * renderer ignored). Encoding the concerns once turns "forgot one" into a
 * missing flag on a single line.
 */
export async function withGitMutation<T>(
  deps: { db: Db; bus: EventBus },
  target: MutationTarget,
  kind: MutationKind,
  describes: string,
  run: (ctx: MutationContext) => Promise<T>,
): Promise<MutationOutcome<T>> {
  // 1. Gate. Only a VADD-owned target has VADD activity to collide with.
  if (target.objective !== null) {
    const verdict = gateForStatus(target.objective.status)
    if (!verdict.allowed) return { ok: false, status: 409, error: verdict.reason }
  }

  const report: MutationReport = { describes, excludedPaths: [], clearedCheckpoints: [] }
  const beforeSha = await headSha(target.worktreePath)
  const ctx: MutationContext = { worktreePath: target.worktreePath, beforeSha, report }

  // 2. `policy.protectedGlobs`, for anything that produces a commit.
  //
  // Before this, the field had exactly one enforcement point — the squash in
  // `integrate.ts` — and before phase 6 it had none at all, which is why the
  // exit run's `backend/.env*` entry failed to stop a tracked `.env.testing`
  // reaching a branch. Applying it here means a manual commit is exactly as
  // unable to carry a protected path as the squash is.
  if (kind.createsCommit && target.protectedGlobs.length > 0) {
    const staged = (
      await gitChecked(target.worktreePath, ['diff', '--cached', '--name-only', '-z'])
    )
      .split('\0')
      .filter((p) => p !== '')
    const excluded = protectedPaths(staged, target.protectedGlobs)
    if (excluded.length > 0) {
      // Un-stage only. The working-tree copy is the user's and is never
      // touched — `git restore --staged` leaves it alone by definition.
      await gitChecked(target.worktreePath, ['restore', '--staged', '--', ...excluded])
      report.excludedPaths = excluded
    }
  }

  let result: T
  try {
    result = await run(ctx)
  } catch (err) {
    const message = errorMessage(err)
    deps.bus.emit({
      objectiveId: target.objective?.id ?? null,
      type: 'git_mutation_failed',
      payload: { describes, message },
    })
    // Deliberately no undo record: one for an operation that never happened
    // would offer to restore the state the repo is already in, and would
    // replace a real record from the previous mutation.
    return { ok: false, status: 500, error: message }
  }

  // 3. Checkpoint repair. Only for a VADD-owned target — a repo-level
  //    mutation has no plan_tasks to repair, and must not reach across to an
  //    objective that merely shares the directory.
  if (kind.rewritesHistory && target.objective !== null) {
    const rows = deps.db
      .select()
      .from(planTasks)
      .where(eq(planTasks.objectiveId, target.objective.id))
      .all()

    for (const row of rows) {
      if (row.checkpointRef === null) continue
      // A checkpoint still reachable from HEAD survived the rewrite; one
      // that is not is either inside a squashed range or gone. Either way it
      // can no longer mean "the state before this task", so it is cleared
      // rather than left to reset to an orphan silently.
      const reachable = await isAncestor(target.worktreePath, row.checkpointRef)
      if (reachable) continue
      deps.db.update(planTasks).set({ checkpointRef: null }).where(eq(planTasks.id, row.id)).run()
      report.clearedCheckpoints.push({ taskId: row.id, ord: row.ord, title: row.title })
    }
    report.clearedCheckpoints.sort((a, b) => a.ord - b.ord)
  }

  // 4. Undo record. Skipped when there was no HEAD to return to.
  if (beforeSha !== null) {
    const at = new Date().toISOString()
    deps.db
      .insert(gitUndo)
      .values({
        worktreePath: target.worktreePath,
        objectiveId: target.objective?.id ?? null,
        branch: target.objective?.branchName ?? null,
        beforeSha,
        describes,
        at,
      })
      .onConflictDoUpdate({
        target: gitUndo.worktreePath,
        set: {
          objectiveId: target.objective?.id ?? null,
          branch: target.objective?.branchName ?? null,
          beforeSha,
          describes,
          at,
        },
      })
      .run()
  }

  deps.bus.emit({
    objectiveId: target.objective?.id ?? null,
    type: 'git_mutation',
    payload: { describes, report },
  })

  return { ok: true, result, report }
}

export async function stagePaths(ctx: MutationContext, paths: string[]): Promise<void> {
  await gitChecked(ctx.worktreePath, ['add', '--', ...paths])
}

export async function unstagePaths(ctx: MutationContext, paths: string[]): Promise<void> {
  await gitChecked(ctx.worktreePath, ['restore', '--staged', '--', ...paths])
}

/** Discards working-tree changes to tracked paths. Untracked files are left. */
export async function discardPaths(ctx: MutationContext, paths: string[]): Promise<void> {
  await gitChecked(ctx.worktreePath, ['restore', '--', ...paths])
}

/** Commits the index. Returns the new sha. */
export async function commitStaged(ctx: MutationContext, message: string): Promise<string> {
  // `-m` with the message as its own argv element: `execa` runs no shell, so
  // a message beginning with `-` cannot be read as an option.
  await gitChecked(ctx.worktreePath, ['commit', '-m', message])
  return (await gitChecked(ctx.worktreePath, ['rev-parse', 'HEAD'])).trim()
}

/**
 * Collapses `from..to` (inclusive) into one commit.
 *
 * Implemented as `reset --soft` to `from`'s parent then a fresh commit — the
 * same shape `runIntegration`'s squash already uses, and deliberately not an
 * interactive rebase: there is no terminal here to resolve one, and a rebase
 * that stops halfway leaves the worktree in a state this pass has no UI for.
 */
export async function squashRange(
  ctx: MutationContext,
  from: string,
  to: string,
  message: string,
): Promise<string> {
  const head = (await gitChecked(ctx.worktreePath, ['rev-parse', 'HEAD'])).trim()
  const toSha = (await gitChecked(ctx.worktreePath, ['rev-parse', to])).trim()
  if (toSha !== head) {
    throw new Error('Only a range ending at HEAD can be squashed in this pass')
  }
  await gitChecked(ctx.worktreePath, ['reset', '--soft', `${from}^`])
  await gitChecked(ctx.worktreePath, ['commit', '-m', message])
  return (await gitChecked(ctx.worktreePath, ['rev-parse', 'HEAD'])).trim()
}

export async function amendHead(
  ctx: MutationContext,
  message: string | null,
  includeStaged: boolean,
): Promise<string> {
  const args = ['commit', '--amend']
  if (!includeStaged) args.push('--only')
  args.push(message === null ? '--no-edit' : '-m', ...(message === null ? [] : [message]))
  await gitChecked(ctx.worktreePath, args)
  return (await gitChecked(ctx.worktreePath, ['rev-parse', 'HEAD'])).trim()
}

export async function rewordCommit(
  ctx: MutationContext,
  sha: string,
  message: string,
): Promise<string> {
  const head = (await gitChecked(ctx.worktreePath, ['rev-parse', 'HEAD'])).trim()
  const target = (await gitChecked(ctx.worktreePath, ['rev-parse', sha])).trim()
  if (target !== head) {
    throw new Error('Only the most recent commit can be reworded in this pass')
  }
  return amendHead(ctx, message, false)
}

export async function dropCommit(ctx: MutationContext, sha: string): Promise<string> {
  const head = (await gitChecked(ctx.worktreePath, ['rev-parse', 'HEAD'])).trim()
  const target = (await gitChecked(ctx.worktreePath, ['rev-parse', sha])).trim()
  if (target !== head) {
    throw new Error('Only the most recent commit can be dropped in this pass')
  }
  await gitChecked(ctx.worktreePath, ['reset', '--hard', 'HEAD^'])
  return (await gitChecked(ctx.worktreePath, ['rev-parse', 'HEAD'])).trim()
}

/** True when `sha` is still reachable from HEAD. */
async function isAncestor(worktreePath: string, sha: string): Promise<boolean> {
  try {
    await gitChecked(worktreePath, ['merge-base', '--is-ancestor', sha, 'HEAD'])
    return true
  } catch {
    // Exit 1 means "not an ancestor"; anything else (a missing object) also
    // means the checkpoint is no longer usable, which is the same verdict.
    return false
  }
}
