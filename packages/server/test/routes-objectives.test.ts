import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import {
  decisions,
  evidenceItems,
  machineSnapshots,
  objectives,
  planTasks,
} from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { listWorktrees } from '../src/git/git-manager.js'
import { buildApp } from '../src/http/app.js'
import { errorMessage } from '../src/http/routes/objectives.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

async function withProject() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const app = buildApp({ db, bus })
  const repo = makeTempRepo()
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { repoPath: repo },
  })
  return { app, bus, db, home, repo, projectId: res.json().id as string }
}

test('creating an objective produces a worktree at the D4 path', async () => {
  const { app, home, repo, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: { title: 'Fix login', goalText: 'Login 500s on empty password' },
  })
  expect(res.statusCode).toBe(201)
  const o = res.json()

  expect(o.status).toBe('idle')
  expect(o.worktreePath).toBe(`${home}/worktrees/${projectId}/${o.id}`)
  expect(o.branchName).toBe(`vadd/${o.id.slice(0, 8)}`)
  expect(existsSync(`${o.worktreePath}/README.md`)).toBe(true)
  expect(await listWorktrees(repo)).toHaveLength(2)
})

test('discarding an objective leaves git worktree list clean', async () => {
  const { app, repo, projectId } = await withProject()
  const o = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
  ).json()

  const res = await app.inject({ method: 'DELETE', url: `/api/objectives/${o.id}` })
  expect(res.statusCode).toBe(200)
  expect(existsSync(o.worktreePath)).toBe(false)
  // v1 release criterion, spec §10.
  expect(await listWorktrees(repo)).toHaveLength(1)

  const gone = await app.inject({ method: 'GET', url: `/api/objectives/${o.id}` })
  expect(gone.statusCode).toBe(404)
})

test('creating an objective for an unknown project returns 404', async () => {
  const { app } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects/does-not-exist/objectives',
    payload: { title: 't', goalText: 'g' },
  })
  expect(res.statusCode).toBe(404)
})

test('lists every objective newest first', async () => {
  const { app, projectId } = await withProject()
  for (const title of ['first', 'second']) {
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title, goalText: 'g' },
    })
  }
  const rows = (await app.inject({ method: 'GET', url: '/api/objectives' })).json() as Array<{
    title: string
  }>
  expect(rows.map((r) => r.title)).toEqual(['second', 'first'])
})

test('M1 commands are rejected in M0', async () => {
  const { app, projectId } = await withProject()
  const o = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
  ).json()
  const res = await app.inject({
    method: 'POST',
    url: `/api/objectives/${o.id}/events`,
    payload: { type: 'integrate', action: 'merge' },
  })
  expect(res.statusCode).toBe(400)
})

test('creation and discard both append events', async () => {
  const { app, bus, projectId } = await withProject()
  const o = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
  ).json()
  await app.inject({ method: 'DELETE', url: `/api/objectives/${o.id}` })
  const types = bus.since(null, 0).map((e) => e.type)
  expect(types).toContain('objective_created')
  expect(types).toContain('objective_discarded')
})

test('errorMessage recovers a message from an ACP-style plain-object rejection', () => {
  // The ACP SDK rejects with plain objects, not Error instances. Without this
  // helper, String(err) on such a rejection yields the literal "[object Object]",
  // which is what a user sees on every agent-start failure.
  const message = errorMessage({ code: -32603, message: 'boom' })
  expect(message).toContain('boom')
  expect(message).not.toContain('[object Object]')
})

test('records the base sha at creation', async () => {
  const { app, db, repo, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: { title: 't', goalText: 'g' },
  })
  expect(res.statusCode).toBe(201)
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim()
  const row = db.select().from(objectives).where(eq(objectives.id, res.json().id)).get()
  expect(row?.baseSha).toBe(head)
})

describe('DELETE /api/objectives/:id', () => {
  test('removes the worktree, the branch and every row', async () => {
    const { app, db, repo, projectId } = await withProject()
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
    const id = created.json().id
    const worktreePath = created.json().worktreePath as string

    const res = await app.inject({ method: 'DELETE', url: `/api/objectives/${id}` })
    expect(res.statusCode).toBe(200)
    expect(db.select().from(objectives).where(eq(objectives.id, id)).get()).toBeUndefined()
    expect(existsSync(worktreePath)).toBe(false)
    // v1 release criterion, spec §10: no leaked worktree admin entry either.
    expect(await listWorktrees(repo)).toHaveLength(1)
  })

  test('404s for an unknown objective', async () => {
    const { app } = await withProject()
    const res = await app.inject({ method: 'DELETE', url: '/api/objectives/nope' })
    expect(res.statusCode).toBe(404)
  })

  test('discards an objective that has machine rows attached', async () => {
    // Phase 3's four tables all reference objectives.id with no cascade, so a
    // delete that touches only agent_sessions trips a FOREIGN KEY violation
    // the moment an objective has ever been driven. Found against the real
    // server: the worktree was removed and the rows survived, leaving an
    // objective pointing at a directory that no longer exists.
    const { app, db, projectId } = await withProject()
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
    const id = created.json().id as string

    const now = new Date().toISOString()
    db.insert(decisions)
      .values({
        id: 'd1',
        objectiveId: id,
        question: 'q',
        options: [],
        recommendedId: 'a',
        chosenId: null,
        decidedAt: null,
        decidedBy: null,
        createdAt: now,
      })
      .run()
    db.insert(planTasks)
      .values({
        id: 't1',
        objectiveId: id,
        ord: 0,
        title: 'task',
        description: 'd',
        status: 'pending',
        checkpointRef: null,
        startedAt: null,
        finishedAt: null,
      })
      .run()
    db.insert(evidenceItems)
      .values({
        id: 'e1',
        objectiveId: id,
        taskId: 't1',
        commandId: null,
        kind: 'test',
        status: 'pass',
        headline: 'ok',
        summary: [],
        artifactPath: null,
        decidedBy: null,
        createdAt: now,
      })
      .run()
    db.insert(machineSnapshots).values({ objectiveId: id, snapshot: {}, updatedAt: now }).run()

    const res = await app.inject({ method: 'DELETE', url: `/api/objectives/${id}` })
    expect(res.statusCode).toBe(200)
    expect(db.select().from(objectives).where(eq(objectives.id, id)).get()).toBeUndefined()
    expect(db.select().from(decisions).where(eq(decisions.objectiveId, id)).all()).toHaveLength(0)
    expect(db.select().from(planTasks).where(eq(planTasks.objectiveId, id)).all()).toHaveLength(0)
    expect(
      db.select().from(evidenceItems).where(eq(evidenceItems.objectiveId, id)).all(),
    ).toHaveLength(0)
    expect(
      db.select().from(machineSnapshots).where(eq(machineSnapshots.objectiveId, id)).all(),
    ).toHaveLength(0)
  })
})
