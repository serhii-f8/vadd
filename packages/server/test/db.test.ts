import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { events, objectives, projects } from '../src/db/schema.js'
import { withTempHome } from './fixtures/temp-repo.js'

test('migrations apply to a fresh database file', () => {
  const home = withTempHome()
  const file = `${home}/vadd.db`
  const db = createDb(file)
  expect(existsSync(file)).toBe(true)
  expect(db.select().from(projects).all()).toEqual([])
})

test('events ids are monotonic and autoincrement', () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const now = new Date().toISOString()
  const a = db
    .insert(events)
    .values({ objectiveId: null, type: 'a', payload: {}, createdAt: now })
    .returning()
    .get()
  const b = db
    .insert(events)
    .values({ objectiveId: null, type: 'b', payload: {}, createdAt: now })
    .returning()
    .get()
  expect(b.id).toBeGreaterThan(a.id)
})

test('objectives may be inserted before their worktree exists', () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const now = new Date().toISOString()
  db.insert(projects)
    .values({ id: 'p1', name: 'p', repoPath: '/tmp/p', config: {}, createdAt: now })
    .run()
  const o = db
    .insert(objectives)
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
    .returning()
    .get()
  expect(o.status).toBe('creating')
  expect(o.worktreePath).toBeNull()
})

test('json payloads round-trip', () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const now = new Date().toISOString()
  db.insert(events)
    .values({ objectiveId: null, type: 't', payload: { nested: { n: 1 } }, createdAt: now })
    .run()
  const row = db.select().from(events).all()[0]
  expect(row?.payload).toEqual({ nested: { n: 1 } })
})
