import { execFileSync } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { gitUndo } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { withGitMutation } from '../src/git/mutate.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

function setup() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const repo = makeTempRepo()
  return { db, bus, repo, deps: { db, bus } }
}

function target(repo: string, over: Record<string, unknown> = {}) {
  return {
    worktreePath: repo,
    owner: { kind: 'user' as const },
    objective: null,
    protectedGlobs: [],
    ...over,
  }
}

const NO_FLAGS = { rewritesHistory: false, createsCommit: false }

test('a permitted mutation runs and reports', async () => {
  const { deps, repo } = setup()
  const out = await withGitMutation(deps, target(repo), NO_FLAGS, 'Test op', async () => 'done')
  expect(out.ok).toBe(true)
  if (!out.ok) throw new Error('unreachable')
  expect(out.result).toBe('done')
  expect(out.report.describes).toBe('Test op')
})

test('a busy objective is refused with 409 and the state named', async () => {
  const { deps, repo } = setup()
  let ran = false
  const out = await withGitMutation(
    deps,
    target(repo, {
      owner: { kind: 'vadd', objectiveId: 'o1', objectiveTitle: 't', objectiveStatus: 'executing' },
      objective: { id: 'o1', status: 'executing', branchName: 'vadd/abc12345' },
    }),
    NO_FLAGS,
    'Test op',
    async () => {
      ran = true
      return 'done'
    },
  )
  expect(out.ok).toBe(false)
  if (out.ok) throw new Error('unreachable')
  expect(out.status).toBe(409)
  expect(out.error).toContain('executing')
  // The operation must not have run at all — a refusal that still touched
  // the worktree would be worse than no gate.
  expect(ran).toBe(false)
})

test('a user-owned target is never gated, whatever an objective is doing', async () => {
  const { deps, repo } = setup()
  const out = await withGitMutation(deps, target(repo), NO_FLAGS, 'Test op', async () => 'done')
  expect(out.ok).toBe(true)
})

test('the undo record captures HEAD before the operation', async () => {
  const { deps, db, repo } = setup()
  const before = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()

  await withGitMutation(deps, target(repo), NO_FLAGS, 'Made a commit', async () => {
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'x'], { stdio: 'pipe' })
    return null
  })

  const row = db.select().from(gitUndo).where(eq(gitUndo.worktreePath, repo)).get()
  expect(row?.beforeSha).toBe(before)
  expect(row?.describes).toBe('Made a commit')
})

test('a failed operation writes no undo record and surfaces the error', async () => {
  const { deps, db, repo } = setup()
  const out = await withGitMutation(deps, target(repo), NO_FLAGS, 'Test op', async () => {
    throw new Error('git blew up')
  })
  expect(out.ok).toBe(false)
  if (out.ok) throw new Error('unreachable')
  expect(out.error).toContain('git blew up')
  // An undo record for an operation that never happened would offer to
  // "restore" a state the repository is already in, and replace a real
  // record from the previous mutation.
  expect(db.select().from(gitUndo).all()).toHaveLength(0)
})

test('a second mutation replaces the undo record rather than appending', async () => {
  const { deps, db, repo } = setup()
  await withGitMutation(deps, target(repo), NO_FLAGS, 'First', async () => null)
  await withGitMutation(deps, target(repo), NO_FLAGS, 'Second', async () => null)
  const rows = db.select().from(gitUndo).all()
  expect(rows).toHaveLength(1)
  expect(rows[0]?.describes).toBe('Second')
})

test('a successful mutation emits an event', async () => {
  const { deps, repo, bus } = setup()
  const seen: string[] = []
  bus.subscribe(null, (e) => seen.push(e.type))
  await withGitMutation(deps, target(repo), NO_FLAGS, 'Test op', async () => null)
  expect(seen).toContain('git_mutation')
})
