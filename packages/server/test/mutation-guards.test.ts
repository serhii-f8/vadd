import { expect, test } from 'vitest'
import { guardOperation } from '../src/git/mutation-guards.js'

const VADD = {
  kind: 'vadd' as const,
  objectiveId: 'o1',
  objectiveTitle: 't',
  objectiveStatus: 'idle',
}
const ORPHAN = { kind: 'orphan' as const }
const USER = { kind: 'user' as const }

test('branch switching is refused on a VADD-owned worktree', () => {
  const verdict = guardOperation('checkout', VADD)
  expect(verdict.allowed).toBe(false)
  if (verdict.allowed) throw new Error('unreachable')
  // objectives.branchName is depended on by /diff, rollingBack, and
  // integrate: discard — which deletes it. A switch without re-pointing the
  // column is how discard deletes a branch the user cares about.
  expect(verdict.reason).toMatch(/branch/i)
})

test('branch switching is allowed on worktrees VADD does not own', () => {
  expect(guardOperation('checkout', USER).allowed).toBe(true)
  expect(guardOperation('checkout', ORPHAN).allowed).toBe(true)
})

test('removing a VADD-owned worktree is refused and names integrate: discard', () => {
  const verdict = guardOperation('removeWorktree', VADD)
  expect(verdict.allowed).toBe(false)
  if (verdict.allowed) throw new Error('unreachable')
  expect(verdict.reason).toContain('discard')
})

test('ordinary operations are allowed on every owner kind', () => {
  for (const op of ['stage', 'unstage', 'discard', 'commit', 'squash', 'amend'] as const) {
    for (const owner of [VADD, ORPHAN, USER]) {
      expect(guardOperation(op, owner).allowed, `${op} on ${owner.kind}`).toBe(true)
    }
  }
})

test('every operation name has a verdict for every owner kind', () => {
  // A new operation added without a rule would otherwise fall through to
  // whatever the default is — which is the shape of every defect this
  // codebase has paid for.
  const ops = [
    'stage',
    'unstage',
    'discard',
    'commit',
    'squash',
    'amend',
    'reword',
    'drop',
    'stash',
    'stashPop',
    'createBranch',
    'deleteBranch',
    'checkout',
    'createWorktree',
    'removeWorktree',
    'undo',
    'pull',
    'push',
  ] as const
  for (const op of ops) {
    for (const owner of [VADD, ORPHAN, USER]) {
      expect(typeof guardOperation(op, owner).allowed).toBe('boolean')
    }
  }
})
