import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { evidenceItems } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { artifactsDirFor } from '../src/paths.js'
import { makeObjectiveRow, withTempHome } from './fixtures/temp-repo.js'

let db: Db
let app: ReturnType<typeof buildApp>
let objectiveId: string

function insertEvidence(id: string, artifactPath: string | null) {
  db.insert(evidenceItems)
    .values({
      id,
      objectiveId,
      commandId: 'test',
      kind: 'test',
      status: 'pass',
      headline: 'ok',
      summary: [],
      artifactPath,
      createdAt: new Date().toISOString(),
    })
    .run()
}

beforeEach(() => {
  withTempHome()
  db = createDb(`${process.env.VADD_HOME}/vadd.db`)
  app = buildApp({ db, bus: new EventBus(db) })
  objectiveId = makeObjectiveRow(db).id
})

describe('GET /api/evidence/:id/artifact', () => {
  it('streams the log the collector wrote', async () => {
    const dir = artifactsDirFor(objectiveId, 'run-1')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'test.log')
    writeFileSync(path, 'PHPUnit 11\nOK (3 tests)\n')
    insertEvidence('e1', path)

    const res = await app.inject({ method: 'GET', url: '/api/evidence/e1/artifact' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toContain('OK (3 tests)')
  })

  it('403s on a path outside ~/.vadd/artifacts', async () => {
    insertEvidence('e2', '/etc/passwd')
    const res = await app.inject({ method: 'GET', url: '/api/evidence/e2/artifact' })
    expect(res.statusCode).toBe(403)
  })

  it('403s on a traversal that escapes the artifacts root', async () => {
    insertEvidence('e3', join(artifactsDirFor(objectiveId, 'run-1'), '..', '..', '..', 'vadd.db'))
    const res = await app.inject({ method: 'GET', url: '/api/evidence/e3/artifact' })
    expect(res.statusCode).toBe(403)
  })

  it('404s when the row carries no artifact', async () => {
    insertEvidence('e4', null)
    const res = await app.inject({ method: 'GET', url: '/api/evidence/e4/artifact' })
    expect(res.statusCode).toBe(404)
  })

  it('404s when the file has been cleaned up', async () => {
    insertEvidence('e5', join(artifactsDirFor(objectiveId, 'run-9'), 'gone.log'))
    const res = await app.inject({ method: 'GET', url: '/api/evidence/e5/artifact' })
    expect(res.statusCode).toBe(404)
  })

  it('404s for an unknown evidence id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/evidence/nope/artifact' })
    expect(res.statusCode).toBe(404)
  })
})
