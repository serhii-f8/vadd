import { existsSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { artifacts, objectives, projects } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { recordArtifact } from '../src/workflow/artifacts.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

function seed() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const now = new Date().toISOString()
  db.insert(projects)
    .values({ id: 'p1', name: 'p', repoPath: `${home}/repo`, config: {}, createdAt: now })
    .run()
  db.insert(objectives)
    .values({
      id: 'o1',
      projectId: 'p1',
      title: 't',
      goalText: 'g',
      worktreePath: null,
      branchName: null,
      status: 'proposing',
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return db
}

test('an artifact row round-trips its cards as JSON', () => {
  const db = seed()
  recordArtifact(db, 'o1', 'proposing', {
    type: 'artifact',
    cards: [{ id: 'why', kind: 'text', title: 'Why', body: 'Because.' }],
  })
  const row = db.select().from(artifacts).where(eq(artifacts.objectiveId, 'o1')).get()
  expect(row?.state).toBe('proposing')
  expect(row?.cards).toEqual([{ id: 'why', kind: 'text', title: 'Why', body: 'Because.' }])
  expect(typeof row?.createdAt).toBe('string')
})

test('artifacts.objective_id is a real foreign key', () => {
  const db = seed()
  expect(() =>
    recordArtifact(db, 'missing', 'proposing', {
      type: 'artifact',
      cards: [{ id: 'a', kind: 'text', title: 'T', body: 'b' }],
    }),
  ).toThrow(/FOREIGN KEY/)
})

async function withObjective() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const app = buildApp({ db, bus })
  const repo = makeTempRepo()
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json()
  const o = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
  ).json()
  return { app, db, objectiveId: o.id as string, worktreePath: o.worktreePath as string }
}

test('the aggregate carries artifacts newest first', async () => {
  const { app, db, objectiveId } = await withObjective()
  const card = (id: string) => [{ id, kind: 'text' as const, title: 'T', body: 'b' }]
  db.insert(artifacts)
    .values({
      id: 'old',
      objectiveId,
      state: 'proposing',
      cards: card('old'),
      createdAt: '2026-09-02T10:00:00.000Z',
    })
    .run()
  db.insert(artifacts)
    .values({
      id: 'new',
      objectiveId,
      state: 'proposing',
      cards: card('new'),
      createdAt: '2026-09-02T10:05:00.000Z',
    })
    .run()
  const res = await app.inject({ method: 'GET', url: `/api/objectives/${objectiveId}` })
  expect(res.statusCode).toBe(200)
  expect(res.json().artifacts.map((a: { id: string }) => a.id)).toEqual(['new', 'old'])
  expect(res.json().artifacts[0].cards).toEqual(card('new'))
})

test('DELETE removes artifact rows with the objective', async () => {
  const { app, db, objectiveId, worktreePath } = await withObjective()
  db.insert(artifacts)
    .values({
      id: 'a',
      objectiveId,
      state: 'proposing',
      cards: [{ id: 'x', kind: 'text', title: 'T', body: 'b' }],
      createdAt: new Date().toISOString(),
    })
    .run()
  const res = await app.inject({ method: 'DELETE', url: `/api/objectives/${objectiveId}` })
  expect(res.statusCode).toBe(200)
  expect(db.select().from(artifacts).where(eq(artifacts.objectiveId, objectiveId)).all()).toEqual(
    [],
  )
  expect(existsSync(worktreePath)).toBe(false)
})
