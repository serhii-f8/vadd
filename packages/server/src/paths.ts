import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
 * Spec: `~/.vadd/artifacts/<objectiveId>/<runId>/`.
 *
 * The `runId` segment is load-bearing, not just tidy: `reconcileEvidence`
 * scopes a command row to the run that produced it by looking for `/<runId>/`
 * in the row's `artifactPath` (design §5.4).
 */
export function artifactsDirFor(objectiveId: string, runId: string): string {
  return join(vaddHome(), 'artifacts', objectiveId, runId)
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

/**
 * The monorepo root, found by walking up from this module's own directory
 * until a directory containing `pnpm-workspace.yaml` turns up.
 *
 * Deliberately not a fixed count of `..` segments. `packages/server/tsconfig.json`
 * sets `rootDir: "."`, so `tsc -b` emits this file to `dist/src/paths.js` — one
 * directory deeper than the `src/paths.ts` that `vitest` and `tsx watch` run
 * directly. A hard-coded `resolve(dirname(...), '..', '..', '..', '..')` lands
 * on the repo root from `src/` and one directory short of it from `dist/`,
 * silently, because nothing in the test suite runs from the built tree — it
 * only breaks the moment someone does `tsc -b && node dist/src/index.js`.
 * Walking up to a marker file gives the same answer regardless of how deep
 * this module sits.
 */
export function repoRoot(): string {
  const start = dirname(fileURLToPath(import.meta.url))
  let dir = start
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`Could not locate repo root: no pnpm-workspace.yaml found above ${start}`)
    }
    dir = parent
  }
}
