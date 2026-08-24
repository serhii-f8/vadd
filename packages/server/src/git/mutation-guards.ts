import type { Owner } from './provenance.js'

export type OperationName =
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'squash'
  | 'amend'
  | 'reword'
  | 'drop'
  | 'stash'
  | 'stashPop'
  | 'createBranch'
  | 'deleteBranch'
  | 'checkout'
  | 'createWorktree'
  | 'removeWorktree'
  | 'undo'
  | 'pull'
  | 'push'

export type GuardVerdict = { allowed: true } | { allowed: false; reason: string }

/**
 * What each operation may do to each kind of target. Spec §7.
 *
 * Only two operations are refused on a VADD-owned target, and both for the
 * same underlying reason: `objectives.branchName` and `objectives.worktreePath`
 * are load-bearing for `/diff`, `rollingBack` and `integrate: discard`, and an
 * operation that invalidates them without VADD noticing turns a routine
 * teardown into deleting work the user cares about.
 *
 * Written as a keyed record rather than a list of exceptions so that adding an
 * operation means adding a key here, not discovering later that it fell
 * through to a silent allow.
 */
const REFUSED_ON_VADD: Partial<Record<OperationName, string>> = {
  checkout:
    "Cannot switch an objective's branch: /diff, rollback and integrate: discard all depend on " +
    'objectives.branchName. Create a branch from this work and check it out in your own worktree instead.',
  removeWorktree:
    "Cannot remove an objective's worktree directly — use integrate: discard, which also clears the " +
    "objective's rows and enforces the leak-free post-conditions.",
}

export function guardOperation(op: OperationName, owner: Owner): GuardVerdict {
  if (owner.kind !== 'vadd') return { allowed: true }
  const reason = REFUSED_ON_VADD[op]
  return reason === undefined ? { allowed: true } : { allowed: false, reason }
}
