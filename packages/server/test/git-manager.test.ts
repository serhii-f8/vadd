import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  createWorktree,
  GitError,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
  validateRepo,
} from '../src/git/git-manager.js'
import { makeTempRepo } from './fixtures/temp-repo.js'

test('validateRepo returns the toplevel for a real repo', async () => {
  const repo = makeTempRepo()
  await expect(validateRepo(repo)).resolves.toContain('vadd-repo-')
})

test('validateRepo distinguishes a missing path from a non-repo', async () => {
  const missing = join(tmpdir(), 'vadd-does-not-exist-12345')
  await expect(validateRepo(missing)).rejects.toMatchObject({ code: 'ENOENT' })

  const notRepo = mkdtempSync(join(tmpdir(), 'vadd-plain-'))
  await expect(validateRepo(notRepo)).rejects.toMatchObject({ code: 'ENOTREPO' })
})

test('worktree create then remove leaves the list clean', async () => {
  const repo = makeTempRepo()
  const wt = join(mkdtempSync(join(tmpdir(), 'vadd-wt-')), 'objective')

  expect(await listWorktrees(repo)).toHaveLength(1)

  await createWorktree(repo, wt, 'vadd/abc12345')
  expect(existsSync(join(wt, 'README.md'))).toBe(true)
  expect(await listWorktrees(repo)).toHaveLength(2)

  await removeWorktree(repo, wt, 'vadd/abc12345')
  expect(existsSync(wt)).toBe(false)
  // This assertion is a v1 release criterion (spec §10): leak-free lifecycle.
  expect(await listWorktrees(repo)).toHaveLength(1)
})

test('removeWorktree succeeds even when the directory is already gone', async () => {
  const repo = makeTempRepo()
  const wt = join(mkdtempSync(join(tmpdir(), 'vadd-wt-')), 'objective')
  await createWorktree(repo, wt, 'vadd/def67890')
  const { rmSync } = await import('node:fs')
  rmSync(wt, { recursive: true, force: true })

  await expect(removeWorktree(repo, wt, 'vadd/def67890')).resolves.toBeUndefined()
  expect(await listWorktrees(repo)).toHaveLength(1)
})

test('pruneWorktrees is safe on a clean repo', async () => {
  const repo = makeTempRepo()
  await expect(pruneWorktrees(repo)).resolves.toBeUndefined()
})

test('removeWorktree throws rather than silently leaking a stuck worktree', async () => {
  const repo = makeTempRepo()
  const wt = join(mkdtempSync(join(tmpdir(), 'vadd-wt-')), 'objective')
  await createWorktree(repo, wt, 'vadd/stuck123')

  // A lock file makes `worktree remove` fail while the directory still exists.
  // prune is a no-op here, so without the post-condition check this call would
  // resolve successfully and leave the worktree registered.
  const { writeFileSync, readdirSync } = await import('node:fs')
  const adminDir = join(repo, '.git', 'worktrees')
  const entry = readdirSync(adminDir)[0]
  if (!entry) throw new Error('expected a worktree admin entry')
  writeFileSync(join(adminDir, entry, 'locked'), 'held by test\n')

  await expect(removeWorktree(repo, wt, 'vadd/stuck123')).rejects.toMatchObject({ code: 'EGIT' })
  expect(await listWorktrees(repo)).toHaveLength(2)
})

test('GitError is thrown, not a raw execa error', async () => {
  const notRepo = mkdtempSync(join(tmpdir(), 'vadd-plain-'))
  await expect(validateRepo(notRepo)).rejects.toBeInstanceOf(GitError)
})
