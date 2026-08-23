import { expect, test } from 'vitest'
import { type OwnedObjective, ownerOfBranch, ownerOfWorktree } from '../src/git/provenance.js'

const objective: OwnedObjective = {
  id: 'fdca5ca3-ecd6-4466-8fc5-77862bc24037',
  title: 'Prove worktree write access',
  status: 'paused',
  branchName: 'vadd/fdca5ca3',
  worktreePath: '/home/u/.vadd/worktrees/p1/fdca5ca3-ecd6-4466-8fc5-77862bc24037',
}

const ROOT = '/home/u/.vadd/worktrees/p1'

test('a branch an objective row names is owned by that objective', () => {
  expect(ownerOfBranch('vadd/fdca5ca3', [objective])).toEqual({
    kind: 'vadd',
    objectiveId: objective.id,
    objectiveTitle: 'Prove worktree write access',
    objectiveStatus: 'paused',
  })
})

test('a branch that looks like VADD but no objective claims is an orphan', () => {
  // The leak signature: an objective row deleted, or a teardown that failed
  // after the row was cleared, leaving the branch behind. Nothing in VADD
  // has ever surfaced one of these.
  expect(ownerOfBranch('vadd/deadbeef', [objective])).toEqual({ kind: 'orphan' })
})

test("a branch the user made is theirs, not VADD's", () => {
  expect(ownerOfBranch('feature/login', [objective])).toEqual({ kind: 'user' })
  expect(ownerOfBranch('main', [objective])).toEqual({ kind: 'user' })
})

test("a branch named like VADD but the wrong shape is the user's", () => {
  // `vadd/` plus something that is not 8 hex characters was not produced by
  // `branchNameFor`, so calling it an orphan would be a false accusation.
  expect(ownerOfBranch('vadd/my-experiment', [objective])).toEqual({ kind: 'user' })
  expect(ownerOfBranch('vadd/FDCA5CA3', [objective])).toEqual({ kind: 'user' })
})

test('an objective with a null branchName claims nothing', () => {
  // Post-integration: `integrate: discard` nulls both columns. The branch is
  // gone too, but if one survives it is genuinely an orphan.
  const integrated = { ...objective, branchName: null, worktreePath: null }
  expect(ownerOfBranch('vadd/fdca5ca3', [integrated])).toEqual({ kind: 'orphan' })
})

test('a worktree an objective row names is owned by that objective', () => {
  expect(ownerOfWorktree(objective.worktreePath as string, [objective], ROOT)).toMatchObject({
    kind: 'vadd',
    objectiveId: objective.id,
  })
})

test('a worktree under the vadd root that no objective claims is an orphan', () => {
  expect(
    ownerOfWorktree(`${ROOT}/00000000-0000-0000-0000-000000000000`, [objective], ROOT),
  ).toEqual({ kind: 'orphan' })
})

test("the main checkout is the user's", () => {
  expect(ownerOfWorktree('/var/www/html/vadd', [objective], ROOT)).toEqual({ kind: 'user' })
})

test('a path merely prefixed by the root string is not under it', () => {
  // `${ROOT}-backup` starts with ROOT as a string but is a sibling directory.
  // A naive startsWith would call it an orphan and invite a user to delete it.
  expect(ownerOfWorktree(`${ROOT}-backup/thing`, [objective], ROOT)).toEqual({ kind: 'user' })
})
