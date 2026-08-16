import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import { reconcileOnBoot } from '../src/boot/reconcile.js'
import { createDb } from '../src/db/client.js'
import { agentSessions, objectives, projects } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { createWorktree, listWorktrees } from '../src/git/git-manager.js'
import { worktreePathFor } from '../src/paths.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

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
