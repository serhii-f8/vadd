import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agentSessions, objectives, projects } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { pruneWorktrees, removeWorktree } from '../git/git-manager.js'
import { branchNameFor, worktreePathFor } from '../paths.js'

/**
 * Kills an adapter child left behind by a hard crash.
 *
 * **Pid reuse is the hazard, and it is not theoretical.** After a `kill -9` and
 * a reboot the recorded number may belong to something else entirely, and
 * killing that would be considerably worse than the orphan it was meant to
 * clean up. So the kill is conditional on the process's own cmdline naming the
 * adapter — the same lesson phase 3 paid for when `pgrep -f "tsx src/index.ts"`
 * matched wrapper shells instead of the process holding the port: confirm what
 * a pid actually is before acting on it.
 *
 * Returns whether a kill was issued. A skip is announced, never silent.
 */
async function killIfAdapter(pid: number, bus: EventBus, objectiveId: string): Promise<boolean> {
  let cmdline = ''
  try {
    // NUL-separated argv. Linux only; on any other platform the read fails and
    // the kill is skipped, which is the safe direction.
    cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\0', ' ')
  } catch {
    bus.emit({
      objectiveId,
      type: 'orphan_kill_skipped',
      payload: { pid, reason: 'process is gone or /proc is unreadable' },
    })
    return false
  }

  if (!cmdline.includes('claude-code-acp')) {
    bus.emit({
      objectiveId,
      type: 'orphan_kill_skipped',
      payload: { pid, reason: 'cmdline does not name the adapter', cmdline: cmdline.slice(0, 200) },
    })
    return false
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Exited between the read and the kill. Nothing to do, and not a failure.
    return false
  }
  bus.emit({ objectiveId, type: 'orphan_killed', payload: { pid } })
  return true
}

/**
 * Three sweeps, all from design §5 / §12.
 *
 * 1. `status = 'creating'` rows are remnants of a crash between the DB insert
 *    and `git worktree add`. Remove any worktree that exists, then the row.
 * 2. `agent_sessions` still marked 'running' belonged to a previous server
 *    process; their children died with it, so mark them 'orphaned'.
 * 3. Each such session's recorded `childPid`, if any, is killed — but only
 *    when the pid's own cmdline still names the adapter (see `killIfAdapter`):
 *    a hard `kill -9` never runs any shutdown path, so the child can outlive
 *    the server that spawned it.
 */
export async function reconcileOnBoot(
  db: Db,
  bus: EventBus,
): Promise<{ cleanedObjectives: number; orphanedSessions: number; killedChildren: number }> {
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
  let killedChildren = 0
  for (const s of running) {
    if (s.childPid !== null) {
      if (await killIfAdapter(s.childPid, bus, s.objectiveId)) killedChildren += 1
    }
    db.update(agentSessions)
      .set({ status: 'orphaned', endedAt: new Date().toISOString() })
      .where(eq(agentSessions.id, s.id))
      .run()
  }

  const result = {
    cleanedObjectives: stale.length,
    orphanedSessions: running.length,
    killedChildren,
  }
  bus.emit({ type: 'boot_reconciled', payload: result })
  return result
}
