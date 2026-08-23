import { relative, resolve } from 'node:path'

export type Owner =
  | { kind: 'vadd'; objectiveId: string; objectiveTitle: string; objectiveStatus: string }
  | { kind: 'orphan' }
  | { kind: 'user' }

/** The columns provenance needs. A subset of the `objectives` row. */
export type OwnedObjective = {
  id: string
  title: string
  status: string
  branchName: string | null
  worktreePath: string | null
}

/**
 * The shape `branchNameFor()` produces: `vadd/` plus the first 8 characters of
 * a UUID, which are always lowercase hex.
 */
const VADD_BRANCH = /^vadd\/[0-9a-f]{8}$/

function owned(o: OwnedObjective): Owner {
  return {
    kind: 'vadd',
    objectiveId: o.id,
    objectiveTitle: o.title,
    objectiveStatus: o.status,
  }
}

/**
 * Ownership is resolved from the objective rows, not from the name pattern.
 *
 * `objectives.branchName` records this fact exactly; matching `vadd/<8hex>` is
 * a guess about the same thing. The pattern is used only as the *secondary*
 * signal that distinguishes an orphan (VADD made this and forgot it) from
 * something the user made — which is a distinction no surface in VADD has
 * ever drawn, despite this project having leaked ten worktrees at ~3.6GB.
 */
export function ownerOfBranch(name: string, objectives: OwnedObjective[]): Owner {
  const claim = objectives.find((o) => o.branchName === name)
  if (claim) return owned(claim)
  return VADD_BRANCH.test(name) ? { kind: 'orphan' } : { kind: 'user' }
}

/**
 * True when `path` lives strictly beneath `root`. `path === root` does not
 * count — the main checkout must not be classed as an orphan of itself.
 */
function isUnder(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  // A sibling like `<root>-backup` yields a relative path starting with '..',
  // which `startsWith(root)` on the raw strings would miss.
  return rel !== '' && !rel.startsWith('..')
}

export function ownerOfWorktree(
  path: string,
  objectives: OwnedObjective[],
  worktreeRoot: string,
): Owner {
  const target = resolve(path)
  const claim = objectives.find(
    (o) => o.worktreePath !== null && resolve(o.worktreePath) === target,
  )
  if (claim) return owned(claim)
  return isUnder(target, worktreeRoot) ? { kind: 'orphan' } : { kind: 'user' }
}
