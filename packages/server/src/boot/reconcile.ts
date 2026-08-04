import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agentSessions, objectives, projects } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { pruneWorktrees, removeWorktree } from '../git/git-manager.js'
import { branchNameFor, worktreePathFor } from '../paths.js'

/**
 * Two sweeps, both from design §5.
 *
 * 1. `status = 'creating'` rows are remnants of a crash between the DB insert
 *    and `git worktree add`. Remove any worktree that exists, then the row.
 * 2. `agent_sessions` still marked 'running' belonged to a previous server
 *    process; their children died with it, so mark them 'orphaned'.
 */
export async function reconcileOnBoot(
  db: Db,
  bus: EventBus,
): Promise<{ cleanedObjectives: number; orphanedSessions: number }> {
  const stale = db.select().from(objectives).where(eq(objectives.status, 'creating')).all()

  for (const o of stale) {
    const project = db.select().from(projects).where(eq(projects.id, o.projectId)).get()
    if (project) {
      const path = o.worktreePath ?? worktreePathFor(o.projectId, o.id)
      const branch = o.branchName ?? branchNameFor(o.id)
      try {
        await removeWorktree(project.repoPath, path, branch)
      } catch (err) {
        // Best-effort: the worktree may never have been created. But say so —
        // silently swallowing this leaves an operator unable to tell a genuine
        // teardown failure from a no-op, across every boot.
        console.warn(`reconcile: could not remove worktree ${path}:`, err)
      }
      await pruneWorktrees(project.repoPath).catch((err: unknown) => {
        console.warn(`reconcile: prune failed for ${project.repoPath}:`, err)
      })
    }
    db.delete(objectives).where(eq(objectives.id, o.id)).run()
  }

  const running = db.select().from(agentSessions).where(eq(agentSessions.status, 'running')).all()
  for (const s of running) {
    db.update(agentSessions)
      .set({ status: 'orphaned', endedAt: new Date().toISOString() })
      .where(eq(agentSessions.id, s.id))
      .run()
  }

  const result = { cleanedObjectives: stale.length, orphanedSessions: running.length }
  bus.emit({ type: 'boot_reconciled', payload: result })
  return result
}
