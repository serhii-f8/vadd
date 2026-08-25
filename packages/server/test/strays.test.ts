import { expect, test } from 'vitest'
import type { OwnedObjective } from '../src/git/provenance.js'
import { findStrays } from '../src/git/strays.js'

const ROOT = '/home/u/.vadd/worktrees/p1'

function obj(over: Partial<OwnedObjective> = {}): OwnedObjective {
  return {
    id: 'o1',
    title: 'Fix the login redirect',
    status: 'paused',
    branchName: 'vadd/o1abc123',
    worktreePath: `${ROOT}/o1`,
    ...over,
  }
}

test('a claimed worktree that is registered and on disk is not a stray', () => {
  const strays = findStrays({
    objectives: [obj()],
    registered: [`${ROOT}/o1`],
    onDisk: [`${ROOT}/o1`],
  })
  expect(strays).toEqual([])
})

test('a claimed worktree missing from disk is vanished', () => {
  const strays = findStrays({
    objectives: [obj()],
    registered: [],
    onDisk: [],
  })
  expect(strays).toEqual([
    {
      kind: 'vanished',
      path: `${ROOT}/o1`,
      claim: {
        objectiveId: 'o1',
        objectiveTitle: 'Fix the login redirect',
        objectiveStatus: 'paused',
      },
      branchName: 'vadd/o1abc123',
    },
  ])
})

test('a claimed worktree still on disk but deregistered is stranded, not vanished', () => {
  // The phase 6 leak shape with a row still pointing at it. `git worktree
  // remove --force` deletes the .git link file before finishing the recursive
  // delete, and the missing link file is what makes `prune` deregister it.
  const strays = findStrays({
    objectives: [obj()],
    registered: [],
    onDisk: [`${ROOT}/o1`],
  })
  expect(strays).toEqual([
    {
      kind: 'stranded',
      path: `${ROOT}/o1`,
      claim: {
        objectiveId: 'o1',
        objectiveTitle: 'Fix the login redirect',
        objectiveStatus: 'paused',
      },
    },
  ])
})

test('an unclaimed directory git does not register is stranded with no claim', () => {
  // The 3.6GB case: `integrate` nulled the columns, the recursive delete
  // failed, and no row points at what is left. Nothing in VADD has ever
  // surfaced one, because it appears in no git output at all.
  const strays = findStrays({
    objectives: [],
    registered: [],
    onDisk: [`${ROOT}/gone`],
  })
  expect(strays).toEqual([{ kind: 'stranded', path: `${ROOT}/gone`, claim: null }])
})

test('an unclaimed directory git DOES register is not a stray — that is provenance orphan', () => {
  // Classing it here would double-report it: the topology route already
  // renders it with owner.kind === 'orphan'.
  const strays = findStrays({
    objectives: [],
    registered: [`${ROOT}/gone`],
    onDisk: [`${ROOT}/gone`],
  })
  expect(strays).toEqual([])
})

test('an objective with no worktreePath is never a stray', () => {
  const strays = findStrays({
    objectives: [obj({ worktreePath: null, branchName: null })],
    registered: [],
    onDisk: [],
  })
  expect(strays).toEqual([])
})

test('paths compare resolved, so a trailing slash is not a second worktree', () => {
  const strays = findStrays({
    objectives: [obj({ worktreePath: `${ROOT}/o1/` })],
    registered: [`${ROOT}/o1`],
    onDisk: [`${ROOT}/o1`],
  })
  expect(strays).toEqual([])
})

test('a vanished row and an unclaimed stranded directory are both reported', () => {
  const strays = findStrays({
    objectives: [obj()],
    registered: [],
    onDisk: [`${ROOT}/leftover`],
  })
  expect(strays).toHaveLength(2)
  expect(strays.map((s) => s.kind).sort()).toEqual(['stranded', 'vanished'])
})

test('a non-normalised path in registered still matches its on-disk directory', () => {
  // `registered` is git's own output, not user input, but the constraint is
  // uniform: every comparison goes through `resolve()`, not just the two
  // sites the earlier tests happened to cover.
  const strays = findStrays({
    objectives: [],
    registered: [`${ROOT}/gone/`],
    onDisk: [`${ROOT}/gone`],
  })
  expect(strays).toEqual([])
})
