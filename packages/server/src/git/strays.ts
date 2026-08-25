import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { listWorktreesDetailed } from './inspect.js'
import type { OwnedObjective } from './provenance.js'

/** The objective a stray belongs to, when one claims it. */
export type StrayClaim = { objectiveId: string; objectiveTitle: string; objectiveStatus: string }

/**
 * A worktree VADD's bookkeeping is wrong about.
 *
 * Two kinds, because they cost different things. A `vanished` row wastes
 * nothing but a lie in the UI — the work is gone and the row survives as a
 * record. A `stranded` directory wastes disk, unboundedly, and is invisible to
 * every tool that would normally find it: it appears in no git output, so no
 * amount of reading `git worktree list` will ever show one.
 *
 * Deliberately not called "orphan". `provenance.ts` has already spent that
 * word on a registered worktree no objective claims, which is a third and
 * different state that the topology route already renders.
 */
export type Stray =
  | { kind: 'vanished'; path: string; claim: StrayClaim; branchName: string | null }
  | { kind: 'stranded'; path: string; claim: StrayClaim | null }

function claimOf(o: OwnedObjective): StrayClaim {
  return { objectiveId: o.id, objectiveTitle: o.title, objectiveStatus: o.status }
}

/**
 * Reconciles three sources into the states that are broken.
 *
 * Pure by design: the logic worth testing exhaustively should not need a
 * filesystem to test, the same split Pass A made between `layoutCommits` and
 * its presentation layer.
 *
 * The two kinds are mutually exclusive by construction — a claimed path absent
 * from disk is `vanished`, a directory present on disk and absent from git's
 * list is `stranded` — so no path is ever reported twice.
 */
export function findStrays(input: {
  objectives: OwnedObjective[]
  /** Paths git reports for this repository. */
  registered: string[]
  /** Directories actually present on disk, as absolute paths. */
  onDisk: string[]
}): Stray[] {
  // Every comparison is between resolved paths. A trailing slash or a `..`
  // segment must not make one worktree read as two — the same reasoning that
  // put `resolve()` inside `isUnder`.
  const registered = new Set(input.registered.map((p) => resolve(p)))
  const onDisk = new Set(input.onDisk.map((p) => resolve(p)))

  const strays: Stray[] = []
  const claims = new Map<string, OwnedObjective>()

  for (const o of input.objectives) {
    if (o.worktreePath === null) continue
    const path = resolve(o.worktreePath)
    claims.set(path, o)
    if (!onDisk.has(path)) {
      strays.push({ kind: 'vanished', path, claim: claimOf(o), branchName: o.branchName })
    }
  }

  for (const path of onDisk) {
    if (registered.has(path)) continue
    const claim = claims.get(path)
    strays.push({ kind: 'stranded', path, claim: claim ? claimOf(claim) : null })
  }

  return strays
}

/**
 * The three reads `findStrays` reconciles.
 *
 * `readdir` is the source nothing in VADD has ever consulted, and it is the
 * only one that can see a `stranded` directory: the topology route builds its
 * worktree list entirely from `listWorktreesDetailed`, so a directory git does
 * not register reaches no screen at all.
 *
 * ENOENT on the root means this project has never created a worktree, which is
 * an empty answer rather than a failure. Every other error propagates — an
 * EACCES here is a real fact about the disk and swallowing it would report
 * "nothing is wrong" about a directory that could not be read.
 */
export async function readStrays(input: {
  objectives: OwnedObjective[]
  repoPath: string
  worktreeRoot: string
}): Promise<Stray[]> {
  let onDisk: string[] = []
  try {
    const entries = await readdir(input.worktreeRoot, { withFileTypes: true })
    onDisk = entries.filter((e) => e.isDirectory()).map((e) => join(input.worktreeRoot, e.name))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const registered = (await listWorktreesDetailed(input.repoPath)).map((w) => w.path)
  return findStrays({
    objectives: input.objectives,
    registered,
    onDisk,
  })
}
