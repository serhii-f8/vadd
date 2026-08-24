import { execFileSync } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { planTasks } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { squashRange, withGitMutation } from '../src/git/mutate.js'
import { makeCheckpointRepo } from './fixtures/checkpoint-repo.js'
import { withTempHome } from './fixtures/temp-repo.js'

function setup() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const fixture = makeCheckpointRepo(db)
  return { db, deps: { db, bus: new EventBus(db) }, ...fixture }
}

function target(repo: string, objectiveId: string) {
  return {
    worktreePath: repo,
    owner: {
      kind: 'vadd' as const,
      objectiveId,
      objectiveTitle: 't',
      objectiveStatus: 'awaitingReview',
    },
    objective: { id: objectiveId, status: 'awaitingReview', branchName: 'master' },
    protectedGlobs: [],
  }
}

const REWRITE = { rewritesHistory: true, createsCommit: true, undoable: true }

function checkpoints(db: ReturnType<typeof createDb>, objectiveId: string) {
  return db
    .select()
    .from(planTasks)
    .where(eq(planTasks.objectiveId, objectiveId))
    .orderBy(planTasks.ord)
    .all()
}

test('squashing the top two commits leaves one', async () => {
  const { deps, repo, objectiveId, shas } = setup()
  const before = execFileSync('git', ['-C', repo, 'rev-list', '--count', 'HEAD'], {
    encoding: 'utf8',
  }).trim()

  const out = await withGitMutation(deps, target(repo, objectiveId), REWRITE, 'Squash 2', (ctx) =>
    squashRange(ctx, shas[2] as string, shas[3] as string, 'squashed'),
  )
  expect(out.ok).toBe(true)

  const after = execFileSync('git', ['-C', repo, 'rev-list', '--count', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  expect(Number(after)).toBe(Number(before) - 1)
})

test('checkpoints below the squashed range keep their shas', async () => {
  const { deps, db, repo, objectiveId, shas } = setup()
  await withGitMutation(deps, target(repo, objectiveId), REWRITE, 'Squash 2', (ctx) =>
    squashRange(ctx, shas[2] as string, shas[3] as string, 'squashed'),
  )
  const rows = checkpoints(db, objectiveId)
  expect(rows[0]?.checkpointRef).toBe(shas[0])
  expect(rows[1]?.checkpointRef).toBe(shas[1])
})

test('checkpoints inside the squashed range are nulled, not silently kept', async () => {
  const { deps, db, repo, objectiveId, shas } = setup()
  await withGitMutation(deps, target(repo, objectiveId), REWRITE, 'Squash 2', (ctx) =>
    squashRange(ctx, shas[2] as string, shas[3] as string, 'squashed'),
  )
  const rows = checkpoints(db, objectiveId)
  // Rolling back to task 2 would land on a commit that also contains task 3.
  // Git resets to an orphaned sha without complaining, so keeping the old
  // value would fail silently — the worst mode for a safety net.
  expect(rows[2]?.checkpointRef).toBeNull()
  expect(rows[3]?.checkpointRef).toBeNull()
})

test('the report names every task that lost its rollback point', async () => {
  const { deps, repo, objectiveId, shas } = setup()
  const out = await withGitMutation(deps, target(repo, objectiveId), REWRITE, 'Squash 2', (ctx) =>
    squashRange(ctx, shas[2] as string, shas[3] as string, 'squashed'),
  )
  expect(out.ok).toBe(true)
  if (!out.ok) throw new Error('unreachable')
  // A nulled checkpoint the user only discovers when they reach for ROLLBACK
  // is the same silent lie the repair exists to prevent.
  expect(out.report.clearedCheckpoints.map((c) => c.ord).sort()).toEqual([2, 3])
  expect(out.report.clearedCheckpoints[0]?.title).toBe('Task 2')
})

test('a rewrite on a repo-level target touches no plan_tasks', async () => {
  const { deps, db, repo, objectiveId, shas } = setup()
  await withGitMutation(
    deps,
    { worktreePath: repo, owner: { kind: 'user' }, objective: null, protectedGlobs: [] },
    REWRITE,
    'Squash 2',
    (ctx) => squashRange(ctx, shas[2] as string, shas[3] as string, 'squashed'),
  )
  // No objective, so nothing to repair — and repair must not reach across
  // to an objective that merely shares the directory.
  const rows = checkpoints(db, objectiveId)
  expect(rows.every((r) => r.checkpointRef !== null)).toBe(true)
})
