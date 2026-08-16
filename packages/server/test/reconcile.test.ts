import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { describe, expect, it, test } from 'vitest'
import { reconcileOnBoot } from '../src/boot/reconcile.js'
import { createDb } from '../src/db/client.js'
import { agentSessions, objectives, projects } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { createWorktree, listWorktrees } from '../src/git/git-manager.js'
import { worktreePathFor } from '../src/paths.js'
import { makeObjectiveRow, makeTempRepo, withTempHome } from './fixtures/temp-repo.js'
import { until } from './fixtures/until.js'

function seed() {
  withTempHome()
  const db = createDb(`${process.env.VADD_HOME}/vadd.db`)
  const bus = new EventBus(db)
  const repo = makeTempRepo()
  const now = new Date().toISOString()
  db.insert(projects)
    .values({ id: 'p1', name: 'p', repoPath: repo, config: {}, createdAt: now })
    .run()
  return { db, bus, repo, now }
}

test('a creating objective with a worktree is cleaned up', async () => {
  const { db, bus, repo, now } = seed()
  const path = worktreePathFor('p1', 'o1')
  await createWorktree(repo, path, 'vadd/o1')
  db.insert(objectives)
    .values({
      id: 'o1',
      projectId: 'p1',
      title: 't',
      goalText: 'g',
      worktreePath: null,
      branchName: null,
      status: 'creating',
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const result = await reconcileOnBoot(db, bus)
  expect(result.cleanedObjectives).toBe(1)
  expect(existsSync(path)).toBe(false)
  expect(await listWorktrees(repo)).toHaveLength(1)
  expect(db.select().from(objectives).all()).toHaveLength(0)
})

test('a creating objective with no worktree is still removed', async () => {
  const { db, bus, now } = seed()
  db.insert(objectives)
    .values({
      id: 'o2',
      projectId: 'p1',
      title: 't',
      goalText: 'g',
      worktreePath: null,
      branchName: null,
      status: 'creating',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  const result = await reconcileOnBoot(db, bus)
  expect(result.cleanedObjectives).toBe(1)
  expect(db.select().from(objectives).all()).toHaveLength(0)
})

test('ready objectives are left alone', async () => {
  const { db, bus, repo, now } = seed()
  const path = worktreePathFor('p1', 'o3')
  await createWorktree(repo, path, 'vadd/o3')
  db.insert(objectives)
    .values({
      id: 'o3',
      projectId: 'p1',
      title: 't',
      goalText: 'g',
      worktreePath: path,
      branchName: 'vadd/o3',
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  await reconcileOnBoot(db, bus)
  expect(db.select().from(objectives).all()).toHaveLength(1)
  expect(existsSync(path)).toBe(true)
})

test('running sessions from a previous process are marked orphaned', async () => {
  const { db, bus, now } = seed()
  db.insert(objectives)
    .values({
      id: 'o4',
      projectId: 'p1',
      title: 't',
      goalText: 'g',
      worktreePath: '/tmp/x',
      branchName: 'vadd/o4',
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  db.insert(agentSessions)
    .values({
      id: 's1',
      objectiveId: 'o4',
      acpSessionId: 'acp-1',
      status: 'running',
      startedAt: now,
      endedAt: null,
    })
    .run()

  const result = await reconcileOnBoot(db, bus)
  expect(result.orphanedSessions).toBe(1)
  const row = db.select().from(agentSessions).all()[0]
  expect(row?.status).toBe('orphaned')
  expect(row?.endedAt).toBeTruthy()
})

test('a setup_failed objective is deliberately not swept', async () => {
  const { db, bus, now } = seed()
  db.insert(objectives)
    .values({
      id: 'o5',
      projectId: 'p1',
      title: 't',
      goalText: 'g',
      worktreePath: '/tmp/x',
      branchName: 'vadd/o5',
      status: 'setup_failed',
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const result = await reconcileOnBoot(db, bus)
  // Unlike `creating`, this row owns the evidence_items row carrying the setup
  // failure log. Deleting it would lose the diagnostic and trip the same
  // foreign key that broke `integrate: discard` in phase 3.
  expect(result.cleanedObjectives).toBe(0)
  expect(db.select().from(objectives).all()).toHaveLength(1)
})

test('reconciliation emits an event describing what it did', async () => {
  const { db, bus } = seed()
  await reconcileOnBoot(db, bus)
  expect(bus.since(null, 0).map((e) => e.type)).toContain('boot_reconciled')
})

describe('adapter orphans (design §12)', () => {
  it('kills a recorded child whose cmdline still names the adapter', async () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    // A real long-lived process whose argv contains the adapter's name, so the
    // cmdline check matches without spawning the actual adapter.
    const child = spawn('node', ['-e', 'setTimeout(() => {}, 60000) // claude-code-acp'], {
      stdio: 'ignore',
    })
    try {
      const objectiveId = makeObjectiveRow(db, { status: 'idle' }).id
      db.insert(agentSessions)
        .values({
          id: 's1',
          objectiveId,
          acpSessionId: 'acp-1',
          status: 'running',
          childPid: child.pid ?? 0,
          startedAt: new Date().toISOString(),
        })
        .run()

      const result = await reconcileOnBoot(db, bus)
      expect(result.killedChildren).toBe(1)
      // Killed via the bare pid (`process.kill`, not `child.kill()`), so
      // `child.killed` never flips and a signal death leaves `exitCode` null —
      // only `signalCode` reflects it. Confirmed by hand against this Node
      // (v22.20.0): `child.kill()` itself leaves `exitCode` null too.
      await until(() => child.exitCode !== null || child.signalCode !== null)
    } finally {
      // Safety net: if an assertion above threw before the kill landed, do not
      // leave a stray node process behind.
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  })

  it('does not kill a pid whose cmdline is something else — pid reuse', async () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    const bystander = spawn('node', ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    try {
      const objectiveId = makeObjectiveRow(db, { status: 'idle' }).id
      db.insert(agentSessions)
        .values({
          id: 's1',
          objectiveId,
          acpSessionId: 'acp-1',
          status: 'running',
          childPid: bystander.pid ?? 0,
          startedAt: new Date().toISOString(),
        })
        .run()

      const result = await reconcileOnBoot(db, bus)
      expect(result.killedChildren).toBe(0)
      expect(bystander.exitCode).toBeNull()
      expect(bus.since(null, 0).some((e) => e.type === 'orphan_kill_skipped')).toBe(true)
    } finally {
      bystander.kill('SIGKILL')
    }
  })

  it('skips and reports a recorded pid that is already gone entirely', async () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    // Spawned, then waited on to fully exit and be reaped before `reconcileOnBoot`
    // ever runs — `/proc/<pid>` is confirmed gone by then (verified by hand:
    // reading it right after the child's own `exit` event reliably ENOENTs on
    // this platform), so this deterministically exercises the same skip-and-report
    // branch the kill-race would, without depending on a race that this Node's
    // own child-reaping makes impossible to land on from a spawned child of the
    // test itself — see the report for why that path isn't covered here.
    const gone = spawn('node', ['-e', 'process.exit(0)'], { stdio: 'ignore' })
    const pid = gone.pid
    if (pid === undefined) throw new Error('spawn did not report a pid')
    await new Promise<void>((resolve) => gone.once('exit', () => resolve()))

    const objectiveId = makeObjectiveRow(db, { status: 'idle' }).id
    db.insert(agentSessions)
      .values({
        id: 's1',
        objectiveId,
        acpSessionId: 'acp-1',
        status: 'running',
        childPid: pid,
        startedAt: new Date().toISOString(),
      })
      .run()

    const result = await reconcileOnBoot(db, bus)
    expect(result.killedChildren).toBe(0)
    const skip = bus
      .since(null, 0)
      .find((e) => e.type === 'orphan_kill_skipped' && (e.payload as { pid: number }).pid === pid)
    expect(skip?.payload).toMatchObject({ reason: 'process is gone or /proc is unreadable' })
  })

  it('marks the session orphaned either way', async () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    const objectiveId = makeObjectiveRow(db, { status: 'idle' }).id
    db.insert(agentSessions)
      .values({
        id: 's1',
        objectiveId,
        acpSessionId: 'acp-1',
        status: 'running',
        childPid: null,
        startedAt: new Date().toISOString(),
      })
      .run()

    await reconcileOnBoot(db, bus)
    expect(db.select().from(agentSessions).where(eq(agentSessions.id, 's1')).get()?.status).toBe(
      'orphaned',
    )
  })
})
