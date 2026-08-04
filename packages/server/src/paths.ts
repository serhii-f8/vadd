import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * All VADD state lives here. `VADD_HOME` exists so tests never touch the
 * developer's real ~/.vadd — every test must set it.
 */
export function vaddHome(): string {
  return process.env.VADD_HOME ?? join(homedir(), '.vadd')
}

export function dbPath(): string {
  return join(vaddHome(), 'vadd.db')
}

/** D4: `~/.vadd/worktrees/<projectId>/<objectiveId>`. This layout is locked. */
export function worktreePathFor(projectId: string, objectiveId: string): string {
  return join(vaddHome(), 'worktrees', projectId, objectiveId)
}

/**
 * Branch names use the first 8 characters of the objective UUID.
 *
 * Lives here beside the worktree layout rather than in the HTTP routes: boot
 * reconciliation needs it too, and having the boot path import from the routes
 * layer inverted the dependency for no reason.
 */
export function branchNameFor(objectiveId: string): string {
  return `vadd/${objectiveId.slice(0, 8)}`
}
