import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { gitUndo } from '../src/db/schema.js'
import { withTempHome } from './fixtures/temp-repo.js'

test('a git_undo row round-trips', () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)

  db.insert(gitUndo)
    .values({
      worktreePath: '/tmp/wt',
      objectiveId: 'o1',
      branch: 'vadd/abc12345',
      beforeSha: 'a'.repeat(40),
      describes: 'Squash 3 commits',
      at: '2026-08-23T10:00:00.000Z',
    })
    .run()

  const row = db.select().from(gitUndo).get()
  expect(row?.beforeSha).toBe('a'.repeat(40))
  expect(row?.describes).toBe('Squash 3 commits')
})

test('a second record for the same worktree replaces the first', () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const base = {
    worktreePath: '/tmp/wt',
    objectiveId: null,
    branch: null,
    at: '2026-08-23T10:00:00.000Z',
  }

  db.insert(gitUndo)
    .values({ ...base, beforeSha: 'a'.repeat(40), describes: 'first' })
    .run()
  db.insert(gitUndo)
    .values({ ...base, beforeSha: 'b'.repeat(40), describes: 'second' })
    .onConflictDoUpdate({
      target: gitUndo.worktreePath,
      set: { beforeSha: 'b'.repeat(40), describes: 'second' },
    })
    .run()

  const rows = db.select().from(gitUndo).all()
  // One row, not two: undo is one step deep by construction, not by a
  // cleanup pass that could be forgotten.
  expect(rows).toHaveLength(1)
  expect(rows[0]?.describes).toBe('second')
})

test('a repo-level record needs no objective', () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  // The main checkout and any user-made worktree have no objective to hang
  // an undo record from; the column must be nullable.
  db.insert(gitUndo)
    .values({
      worktreePath: '/var/www/repo',
      objectiveId: null,
      branch: 'master',
      beforeSha: 'c'.repeat(40),
      describes: 'Commit 2 files',
      at: '2026-08-23T10:00:00.000Z',
    })
    .run()
  expect(db.select().from(gitUndo).get()?.objectiveId).toBeNull()
})
