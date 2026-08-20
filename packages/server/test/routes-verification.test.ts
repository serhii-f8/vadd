import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { evidenceItems, objectives } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'
import { until } from './fixtures/until.js'

let db: Db
let app: ReturnType<typeof buildApp>
let repo: string
let projectId: string

beforeEach(async () => {
  const home = withTempHome()
  db = createDb(`${home}/vadd.db`)
  app = buildApp({ db, bus: new EventBus(db) })
  repo = makeTempRepo()
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
  projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json().id
})

async function create(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: { title: 't', goalText: 'g', ...payload },
  })
}

describe('GET /api/projects/:id/verification', () => {
  it('previews the detected spec', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/verification` })
    expect(res.statusCode).toBe(200)
    expect(res.json().kind).toBe('resolved')
    expect(res.json().spec.verify.commands[0].id).toBe('test')
  })

  it('reports none, naming what was scanned', async () => {
    const bare = makeTempRepo()
    const other = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: bare } })
    ).json().id
    const res = await app.inject({ method: 'GET', url: `/api/projects/${other}/verification` })
    expect(res.json().kind).toBe('none')
    expect(res.json().scanned).toContain('.')
  })

  it('404s for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/nope/verification' })
    expect(res.statusCode).toBe(404)
  })
})

describe('resolution at objective creation', () => {
  it('stores the detected spec on the objective', async () => {
    const id = (await create({})).json().id
    const row = db.select().from(objectives).where(eq(objectives.id, id)).get()
    expect(row?.verificationSpec).toBeTruthy()
    const spec = row?.verificationSpec as { verify: { commands: { id: string }[] } }
    expect(spec.verify.commands[0]?.id).toBe('test')
  })

  it('merges verificationOverrides onto the detected base', async () => {
    const id = (await create({ verificationOverrides: { verify: { timeoutSec: 30 } } })).json().id
    const row = db.select().from(objectives).where(eq(objectives.id, id)).get()
    const spec = row?.verificationSpec as { verify: { timeoutSec: number; commands: unknown[] } }
    expect(spec.verify.timeoutSec).toBe(30)
    expect(spec.verify.commands).toHaveLength(1)
  })

  it('leaves verificationSpec null when nothing resolves, and says so', async () => {
    const bare = makeTempRepo()
    const other = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: bare } })
    ).json().id
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${other}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
    expect(res.statusCode).toBe(201)
    const row = db.select().from(objectives).where(eq(objectives.id, res.json().id)).get()
    expect(row?.verificationSpec).toBeNull()
  })

  it('refuses a spec carrying a denied command, and creates nothing', async () => {
    mkdirSync(join(repo, '.vadd'), { recursive: true })
    writeFileSync(
      join(repo, '.vadd', 'config.json'),
      JSON.stringify({
        verify: { commands: [{ id: 'evil', run: 'sudo rm -rf /', required: true }] },
      }),
    )
    const res = await create({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/evil/)
    expect(res.json().error).toMatch(/sudo/i)
    expect(db.select().from(objectives).all()).toHaveLength(0)
  })

  it('refuses a malformed config, and creates nothing', async () => {
    mkdirSync(join(repo, '.vadd'), { recursive: true })
    writeFileSync(join(repo, '.vadd', 'config.json'), '{ not json')
    const res = await create({})
    expect(res.statusCode).toBe(400)
    expect(db.select().from(objectives).all()).toHaveLength(0)
  })

  it('returns 201 immediately and moves to idle when setup succeeds', async () => {
    mkdirSync(join(repo, '.vadd'), { recursive: true })
    writeFileSync(
      join(repo, '.vadd', 'config.json'),
      JSON.stringify({
        verify: {
          setup: [{ id: 'deps', run: 'echo installed > installed.txt' }],
          commands: [{ id: 'test', run: 'true', required: true }],
        },
      }),
    )
    const res = await create({})
    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('creating')

    const id = res.json().id
    await until(() => {
      const row = db.select().from(objectives).where(eq(objectives.id, id)).get()
      return row?.status === 'idle'
    })
    const row = db.select().from(objectives).where(eq(objectives.id, id)).get()
    expect(row?.setupAt).toBeTruthy()
  })

  it('lands in setup_failed when a setup command fails', async () => {
    mkdirSync(join(repo, '.vadd'), { recursive: true })
    writeFileSync(
      join(repo, '.vadd', 'config.json'),
      JSON.stringify({
        verify: {
          setup: [{ id: 'deps', run: 'exit 1' }],
          commands: [{ id: 'test', run: 'true', required: true }],
        },
      }),
    )
    const id = (await create({})).json().id
    await until(() => {
      const row = db.select().from(objectives).where(eq(objectives.id, id)).get()
      return row?.status === 'setup_failed'
    })
  })

  it('investigation mode ignores repo auto-detection and gets the checks-only default', async () => {
    const id = (await create({ mode: 'investigation' })).json().id
    const row = db.select().from(objectives).where(eq(objectives.id, id)).get()
    const spec = row?.verificationSpec as {
      verify: { commands: unknown[]; checks: string[] }
    }
    expect(spec.verify.commands).toEqual([])
    expect(spec.verify.checks).toHaveLength(1)
  })

  it('investigation mode still merges a per-objective override', async () => {
    const id = (
      await create({
        mode: 'investigation',
        verificationOverrides: { verify: { timeoutSec: 30 } },
      })
    ).json().id
    const row = db.select().from(objectives).where(eq(objectives.id, id)).get()
    const spec = row?.verificationSpec as { verify: { timeoutSec: number } }
    expect(spec.verify.timeoutSec).toBe(30)
  })
})

describe('POST /api/objectives/:id/events tick_check', () => {
  let objectiveId: string
  let objectiveIdWithNoSpec: string

  beforeEach(async () => {
    // A config with one check, so `check-0` is a declared id on this objective.
    mkdirSync(join(repo, '.vadd'), { recursive: true })
    writeFileSync(
      join(repo, '.vadd', 'config.json'),
      JSON.stringify({
        verify: {
          commands: [{ id: 'test', run: 'true', required: true }],
          checks: ['Bug is reproduced by a failing test'],
        },
      }),
    )
    objectiveId = (await create({})).json().id

    const bare = makeTempRepo()
    const other = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: bare } })
    ).json().id
    objectiveIdWithNoSpec = (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${other}/objectives`,
        payload: { title: 't', goalText: 'g' },
      })
    ).json().id
  })

  it('records a tick as a check row with decidedBy user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'tick_check', checkId: 'check-0', satisfied: true },
    })
    expect(res.statusCode).toBe(202)
    const row = db.select().from(evidenceItems).all()[0]
    expect(row?.commandId).toBe('check-0')
    expect(row?.kind).toBe('check')
    expect(row?.status).toBe('pass')
    expect(row?.decidedBy).toBe('user')
  })

  it('an untick records a failing row, not a deletion', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'tick_check', checkId: 'check-0', satisfied: false },
    })
    expect(db.select().from(evidenceItems).all()[0]?.status).toBe('fail')
  })

  it('refuses a checkId the spec does not declare', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'tick_check', checkId: 'check-99', satisfied: true },
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses a tick on an objective with no verification spec', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveIdWithNoSpec}/events`,
      payload: { type: 'tick_check', checkId: 'check-0', satisfied: true },
    })
    expect(res.statusCode).toBe(400)
  })
})
