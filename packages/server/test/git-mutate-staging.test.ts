import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { EventBus } from '../src/events/event-bus.js'
import {
  commitStaged,
  discardPaths,
  stagePaths,
  unstagePaths,
  withGitMutation,
} from '../src/git/mutate.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

function setup() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  return { db, deps: { db, bus: new EventBus(db) }, repo: makeTempRepo() }
}

function target(repo: string, protectedGlobs: string[] = []) {
  return { worktreePath: repo, owner: { kind: 'user' as const }, objective: null, protectedGlobs }
}

const STAGE = { rewritesHistory: false, createsCommit: false, undoable: true }
const COMMIT = { rewritesHistory: false, createsCommit: true, undoable: true }

function statusOf(repo: string): string {
  return execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' })
}

test('staging a path puts it in the index', async () => {
  const { deps, repo } = setup()
  writeFileSync(join(repo, 'new.txt'), 'x\n')
  await withGitMutation(deps, target(repo), STAGE, 'Stage', (ctx) => stagePaths(ctx, ['new.txt']))
  expect(statusOf(repo)).toContain('A  new.txt')
})

test('unstaging removes it from the index but keeps the file', async () => {
  const { deps, repo } = setup()
  writeFileSync(join(repo, 'new.txt'), 'x\n')
  await withGitMutation(deps, target(repo), STAGE, 'Stage', (ctx) => stagePaths(ctx, ['new.txt']))
  // Asserted before the unstage, deliberately. Without it this test passes
  // against an implementation that does nothing at all: an unstaged file is
  // already `?? new.txt` and already not `A  new.txt`, so both closing
  // assertions hold vacuously and the test cannot fail for its target.
  expect(statusOf(repo)).toContain('A  new.txt')

  await withGitMutation(deps, target(repo), STAGE, 'Unstage', (ctx) =>
    unstagePaths(ctx, ['new.txt']),
  )
  const status = statusOf(repo)
  expect(status).toContain('?? new.txt')
  expect(status).not.toContain('A  new.txt')
})

test('discarding a tracked modification restores it', async () => {
  const { deps, repo } = setup()
  writeFileSync(join(repo, 'README.md'), 'changed\n')
  await withGitMutation(deps, target(repo), STAGE, 'Discard', (ctx) =>
    discardPaths(ctx, ['README.md']),
  )
  expect(statusOf(repo).trim()).toBe('')
})

test('committing what is staged produces a real commit', async () => {
  const { deps, repo } = setup()
  writeFileSync(join(repo, 'new.txt'), 'x\n')
  await withGitMutation(deps, target(repo), STAGE, 'Stage', (ctx) => stagePaths(ctx, ['new.txt']))
  const out = await withGitMutation(deps, target(repo), COMMIT, 'Commit', (ctx) =>
    commitStaged(ctx, 'add new.txt'),
  )
  expect(out.ok).toBe(true)
  const subject = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], {
    encoding: 'utf8',
  }).trim()
  expect(subject).toBe('add new.txt')
})

test('a protected path is kept out of the commit AND named in the report', async () => {
  const { deps, repo } = setup()
  writeFileSync(join(repo, 'secret.env'), 'KEY=1\n')
  writeFileSync(join(repo, 'ok.txt'), 'fine\n')
  await withGitMutation(deps, target(repo), STAGE, 'Stage', (ctx) =>
    stagePaths(ctx, ['secret.env', 'ok.txt']),
  )

  const out = await withGitMutation(deps, target(repo, ['*.env']), COMMIT, 'Commit', (ctx) =>
    commitStaged(ctx, 'add files'),
  )

  expect(out.ok).toBe(true)
  if (!out.ok) throw new Error('unreachable')
  // Named, not dropped quietly: a commit that silently omits a file the user
  // believed they were committing is the same class of lie as an evidence
  // set that silently goes missing.
  expect(out.report.excludedPaths).toEqual(['secret.env'])

  const files = execFileSync('git', ['-C', repo, 'show', '--name-only', '--format=', 'HEAD'], {
    encoding: 'utf8',
  })
  expect(files).toContain('ok.txt')
  expect(files).not.toContain('secret.env')
})

test('a protected path survives in the working tree after exclusion', async () => {
  const { deps, repo } = setup()
  writeFileSync(join(repo, 'secret.env'), 'KEY=1\n')
  writeFileSync(join(repo, 'ok.txt'), 'fine\n')
  await withGitMutation(deps, target(repo), STAGE, 'Stage', (ctx) =>
    stagePaths(ctx, ['secret.env', 'ok.txt']),
  )
  const out = await withGitMutation(deps, target(repo, ['*.env']), COMMIT, 'Commit', (ctx) =>
    commitStaged(ctx, 'add ok.txt only'),
  )
  // The commit must actually have happened. Without this the test passes
  // against an implementation that does nothing: an unstaged `secret.env` is
  // present in `status` for the trivial reason that it was never staged.
  expect(out.ok).toBe(true)

  // Exclusion un-stages; it must never delete the user's file. `?? ` rather
  // than a bare substring, so "still in the working tree, unstaged" is what
  // is actually asserted.
  expect(statusOf(repo)).toContain('?? secret.env')
})
