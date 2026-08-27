import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it, test } from 'vitest'
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

test('lists verifiedCount and totalCount per objective', async () => {
  const { app, db, projectId } = await withProject()
  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: { title: 'has tasks', goalText: 'g' },
  })
  const objectiveId = created.json().id as string
  const now = new Date().toISOString()
  db.insert(planTasks)
    .values([
      {
        id: `${objectiveId}:0`,
        objectiveId,
        ord: 0,
        title: 'a',
        description: 'd',
        status: 'verified',
        checkpointRef: null,
        startedAt: now,
        finishedAt: now,
      },
      {
        id: `${objectiveId}:1`,
        objectiveId,
        ord: 1,
        title: 'b',
        description: 'd',
        status: 'running',
        checkpointRef: null,
        startedAt: now,
        finishedAt: null,
      },
      {
        id: `${objectiveId}:2`,
        objectiveId,
        ord: 2,
        title: 'c',
        description: 'd',
        status: 'pending',
        checkpointRef: null,
        startedAt: null,
        finishedAt: null,
      },
    ])
    .run()

  const rows = (await app.inject({ method: 'GET', url: '/api/objectives' })).json() as Array<{
    id: string
    verifiedCount: number
    totalCount: number
  }>
  const row = rows.find((r) => r.id === objectiveId)
  expect(row?.verifiedCount).toBe(1)
  expect(row?.totalCount).toBe(3)
})

test('?projectId= filters the board to one project', async () => {
  const { app, projectId: projectA } = await withProject()
  const resB = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { repoPath: makeTempRepo() },
  })
  const projectB = resB.json().id as string

  await app.inject({
    method: 'POST',
    url: `/api/projects/${projectA}/objectives`,
    payload: { title: 'in A', goalText: 'g' },
  })
  await app.inject({
    method: 'POST',
    url: `/api/projects/${projectB}/objectives`,
    payload: { title: 'in B', goalText: 'g' },
  })

  const filtered = (
    await app.inject({ method: 'GET', url: `/api/objectives?projectId=${projectA}` })
  ).json() as Array<{ title: string }>
  expect(filtered.map((r) => r.title)).toEqual(['in A'])

  const unfiltered = (await app.inject({ method: 'GET', url: '/api/objectives' })).json() as Array<{
    title: string
  }>
  expect(unfiltered.map((r) => r.title).sort()).toEqual(['in A', 'in B'])
})

test('an objective with no plan yet shows 0/0, not a crash', async () => {
  const { app, projectId } = await withProject()
  await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: { title: 'no plan', goalText: 'g' },
  })
  const rows = (await app.inject({ method: 'GET', url: '/api/objectives' })).json() as Array<{
    verifiedCount: number
    totalCount: number
  }>
  expect(rows[0]).toMatchObject({ verifiedCount: 0, totalCount: 0 })
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

test('rejects integrate: commit for an investigation-mode objective', async () => {
  const { app, projectId } = await withProject()
  const o = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g', mode: 'investigation' },
    })
  ).json()
  const res = await app.inject({
    method: 'POST',
    url: `/api/objectives/${o.id}/events`,
    payload: { type: 'integrate', action: 'commit' },
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toMatch(/investigation/)
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

test('the aggregate reports whether the objective worktree is still there', async () => {
  const { app, projectId } = await withProject()
  const o = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 'Fix login', goalText: 'g' },
    })
  ).json() as { id: string; worktreePath: string }

  const before = await app.inject({ method: 'GET', url: `/api/objectives/${o.id}` })
  expect(before.json().worktreeMissing).toBe(false)

  // Deleted behind git's back, which is exactly how the live database got
  // four rows in this state.
  rmSync(o.worktreePath, { recursive: true, force: true })
  const after = await app.inject({ method: 'GET', url: `/api/objectives/${o.id}` })
  expect(after.json().worktreeMissing).toBe(true)
})

test('an objective with no worktree at all is not reported as missing', async () => {
  const { app, db, projectId } = await withProject()
  const o = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 'Fix login', goalText: 'g' },
    })
  ).json() as { id: string }
  // `integrate: commit` and `discard` both null these columns. A done
  // objective is not broken, and must not be flagged as though it were.
  db.update(objectives)
    .set({ status: 'done', worktreePath: null, branchName: null })
    .where(eq(objectives.id, o.id))
    .run()

  const res = await app.inject({ method: 'GET', url: `/api/objectives/${o.id}` })
  expect(res.json().worktreeMissing).toBe(false)
})

describe('POST /api/projects/:id/objectives — continuedFromId', () => {
  it("bases the new worktree on the prior objective's branch when it still exists", async () => {
    const repo = makeTempRepo()
    execFileSync('git', ['-C', repo, 'branch', 'vadd/prior12345'])
    execFileSync('git', ['-C', repo, 'checkout', 'vadd/prior12345'])
    await writeFile(join(repo, 'b.txt'), 'work done on the prior objective')
    execFileSync('git', ['-C', repo, 'add', '-A'])
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'prior work'])
    const priorTip = execFileSync('git', ['-C', repo, 'rev-parse', 'vadd/prior12345'])
      .toString()
      .trim()
    execFileSync('git', ['-C', repo, 'checkout', 'master'])

    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    const app = buildApp({ db, bus })
    const projectId = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
    ).json().id as string

    db.insert(objectives)
      .values({
        id: 'prior-obj',
        projectId,
        title: 'Prior',
        goalText: 'g',
        branchName: 'vadd/prior12345',
        status: 'done',
        mode: 'standard',
        lowEnergy: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run()

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 'Follow-up', goalText: 'g2', continuedFromId: 'prior-obj' },
    })
    expect(res.statusCode).toBe(201)
    const created = res.json()
    expect(created.continuedFromId).toBe('prior-obj')
    expect(created.baseSha).toBe(priorTip)
  })

  it('falls back to the default branch when the prior branch is gone', async () => {
    const repo = makeTempRepo()
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim()

    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    const app = buildApp({ db, bus })
    const projectId = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
    ).json().id as string

    db.insert(objectives)
      .values({
        id: 'discarded-obj',
        projectId,
        title: 'Discarded',
        goalText: 'g',
        branchName: null,
        integrateAction: 'discard',
        status: 'done',
        mode: 'standard',
        lowEnergy: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run()

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 'Follow-up', goalText: 'g2', continuedFromId: 'discarded-obj' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().baseSha).toBe(head)
  })

  it('does not error when continuedFromId names a nonexistent objective', async () => {
    const repo = makeTempRepo()
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    const app = buildApp({ db, bus })
    const projectId = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
    ).json().id as string

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 'Follow-up', goalText: 'g2', continuedFromId: 'nope' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().continuedFromId).toBe('nope')
  })
})
