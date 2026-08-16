import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import { beforeEach, describe, expect, it, test } from 'vitest'
import {
  checkpointCommit,
  createWorktree,
  GitError,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
  resetHard,
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

describe('checkpointCommit', () => {
  let wt: string

  beforeEach(() => {
    wt = makeTempRepo()
  })

  it('commits everything and returns the sha', async () => {
    await writeFile(join(wt, 'a.txt'), 'hello')
    const sha = await checkpointCommit(wt, 'vadd-checkpoint: task 0')
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/)
    const log = await execa('git', ['-C', wt, 'log', '-1', '--pretty=%s'])
    expect(log.stdout).toBe('vadd-checkpoint: task 0')
  })

  it('returns null on a clean tree rather than making an empty commit', async () => {
    await checkpointCommit(wt, 'vadd-checkpoint: first')
    expect(await checkpointCommit(wt, 'vadd-checkpoint: again')).toBeNull()
  })

  it('resetHard returns the tree to a checkpoint', async () => {
    await writeFile(join(wt, 'a.txt'), 'v1')
    const sha = await checkpointCommit(wt, 'vadd-checkpoint: v1')
    await writeFile(join(wt, 'a.txt'), 'v2')
    await resetHard(wt, sha as string)
    expect(await readFile(join(wt, 'a.txt'), 'utf8')).toBe('v1')
  })
})

describe('A8: base sha and optional branch deletion', () => {
  it('createWorktree returns the sha it branched from', async () => {
    const repo = makeTempRepo()
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim()
    const wt = join(mkdtempSync(join(tmpdir(), 'vadd-wt-')), 'w')
    const base = await createWorktree(repo, wt, 'vadd/test1')
    expect(base).toBe(head)
  })

  it('removeWorktree with a null branch keeps the branch', async () => {
    const repo = makeTempRepo()
    const wt = join(mkdtempSync(join(tmpdir(), 'vadd-wt-')), 'w')
    await createWorktree(repo, wt, 'vadd/keepme')
    await removeWorktree(repo, wt, null)
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'vadd/keepme'])
      .toString()
      .trim()
    expect(branches).toContain('vadd/keepme')
    expect(await listWorktrees(repo)).not.toContain(resolve(wt))
  })

  it('removeWorktree with a branch still deletes it', async () => {
    const repo = makeTempRepo()
    const wt = join(mkdtempSync(join(tmpdir(), 'vadd-wt-')), 'w')
    await createWorktree(repo, wt, 'vadd/goodbye')
    await removeWorktree(repo, wt, 'vadd/goodbye')
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'vadd/goodbye'])
      .toString()
      .trim()
    expect(branches).toBe('')
  })
})
