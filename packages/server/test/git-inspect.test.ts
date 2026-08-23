import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { listBranches, listWorktreesDetailed, readLog, readStatus } from '../src/git/inspect.js'
import { makeTempRepo } from './fixtures/temp-repo.js'

/**
 * A repo with a real merge: root → (feat: one commit) and (main: one commit),
 * then a --no-ff merge. This is the shape that exercises multi-parent commits
 * and lane layout; a linear fixture would let a broken parser pass.
 */
function repoWithMerge(): { repo: string; main: string } {
  const repo = makeTempRepo()
  const g = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  const main = execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  g('checkout', '-qb', 'feat')
  writeFileSync(join(repo, 'b.txt'), 'b\n')
  g('add', '-A')
  g('commit', '-qm', 'on feat')
  g('checkout', '-q', main)
  writeFileSync(join(repo, 'c.txt'), 'c\n')
  g('add', '-A')
  g('commit', '-qm', 'on main')
  g('merge', '-q', '--no-ff', 'feat', '-m', 'merge feat')
  return { repo, main }
}

test('listBranches reports every branch and marks the checked-out one', async () => {
  const { repo, main } = repoWithMerge()
  const branches = await listBranches(repo)
  expect(branches.map((b) => b.name).sort()).toEqual(['feat', main].sort())
  expect(branches.find((b) => b.name === main)?.isCurrent).toBe(true)
  expect(branches.find((b) => b.name === 'feat')?.isCurrent).toBe(false)
  expect(branches.find((b) => b.name === 'feat')?.upstream).toBeNull()
  expect(branches.every((b) => /^[0-9a-f]{40}$/.test(b.sha))).toBe(true)
})

test('readLog reports both parents of a merge commit', async () => {
  const { repo } = repoWithMerge()
  const log = await readLog(repo, { limit: 50 })
  const merge = log.find((c) => c.subject === 'merge feat')
  expect(merge).toBeDefined()
  expect(merge?.parents).toHaveLength(2)
})

test('readLog reports a root commit as having no parents', async () => {
  const { repo } = repoWithMerge()
  const log = await readLog(repo, { limit: 50 })
  // An empty %P must parse to [], not to ['']. A stray empty-string parent
  // would make the lane layout open a rail waiting for a commit that can
  // never arrive.
  expect(log.at(-1)?.parents).toEqual([])
})

test('readLog carries ref decorations on a branch tip and none elsewhere', async () => {
  const { repo } = repoWithMerge()
  const log = await readLog(repo, { limit: 50 })
  expect(log.find((c) => c.subject === 'on feat')?.refs).toContain('feat')
  expect(log.find((c) => c.subject === 'on main')?.refs).toEqual([])
})

test('readLog pages with before, excluding the cursor commit itself', async () => {
  const { repo } = repoWithMerge()
  const all = await readLog(repo, { limit: 50 })
  const cursor = all[1]
  if (!cursor) throw new Error('fixture needs at least two commits')
  const page = await readLog(repo, { limit: 50, before: cursor.sha })
  expect(page.map((c) => c.sha)).not.toContain(cursor.sha)
  expect(page[0]?.sha).toBe(all[2]?.sha)
})

test('readLog honours limit', async () => {
  const { repo } = repoWithMerge()
  expect(await readLog(repo, { limit: 2 })).toHaveLength(2)
})

test('listWorktreesDetailed reports the main checkout and a linked worktree', async () => {
  const { repo } = repoWithMerge()
  const wt = join(mkdtempSync(join(tmpdir(), 'vadd-wt-')), 'linked')
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', wt, 'feat'], { stdio: 'pipe' })

  const rows = await listWorktreesDetailed(repo)
  expect(rows).toHaveLength(2)
  const mainRow = rows.find((r) => r.isMain)
  const linked = rows.find((r) => !r.isMain)
  expect(mainRow?.path).toBe(repo)
  expect(linked?.branch).toBe('feat')
  expect(linked?.locked).toBe(false)
  expect(/^[0-9a-f]{40}$/.test(linked?.head ?? '')).toBe(true)
})

test('listWorktreesDetailed reports a detached worktree as having no branch', async () => {
  const { repo } = repoWithMerge()
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const wt = join(mkdtempSync(join(tmpdir(), 'vadd-wt-')), 'detached')
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', wt, head], {
    stdio: 'pipe',
  })

  const rows = await listWorktreesDetailed(repo)
  // `branch: null` rather than a guessed name: a detached worktree genuinely
  // has no branch, and inventing one would make the console claim a binding
  // that does not exist.
  expect(rows.find((r) => r.path === wt)?.branch).toBeNull()
})

test('readStatus counts staged, unstaged and untracked separately', async () => {
  const { repo } = repoWithMerge()
  const g = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })

  writeFileSync(join(repo, 'staged.txt'), 'new\n')
  g('add', 'staged.txt')
  writeFileSync(join(repo, 'c.txt'), 'modified\n') // tracked, not staged
  writeFileSync(join(repo, 'untracked.txt'), 'u\n')

  expect(await readStatus(repo)).toEqual({ staged: 1, unstaged: 1, untracked: 1 })
})

test('readStatus is all zeroes on a clean tree', async () => {
  const { repo } = repoWithMerge()
  expect(await readStatus(repo)).toEqual({ staged: 0, unstaged: 0, untracked: 0 })
})
