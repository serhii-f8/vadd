import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { artifacts, objectives, projects } from '../src/db/schema.js'
import { recordArtifact } from '../src/workflow/artifacts.js'
import { withTempHome } from './fixtures/temp-repo.js'

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
