import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

function app() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  return buildApp({ db, bus: new EventBus(db) })
}

test('registering a valid repo returns 201 and persists it', async () => {
  const a = app()
  const repo = makeTempRepo()
  const res = await a.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.repoPath).toContain('vadd-repo-')
  expect(body.id).toBeTruthy()

  const list = await a.inject({ method: 'GET', url: '/api/projects' })
  expect(list.json()).toHaveLength(1)
})

test('a non-git path is rejected with a specific message', async () => {
  const a = app()
  const plain = mkdtempSync(join(tmpdir(), 'vadd-plain-'))
  const res = await a.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: plain } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toMatch(/not a git repository/i)
})

test('a missing path reports differently from a non-repo', async () => {
  const a = app()
  const res = await a.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { repoPath: join(tmpdir(), 'vadd-nope-99999') },
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toMatch(/does not exist/i)
})

test('an invalid body is rejected by schema validation', async () => {
  const a = app()
  const res = await a.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: '' } })
  expect(res.statusCode).toBe(400)
})

test('registering the same repo twice returns 409 with a distinct message', async () => {
  const a = app()
  const repo = makeTempRepo()
  await a.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  const res = await a.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  expect(res.statusCode).toBe(409)
  // The status code alone was asserted before, while the design's verification
  // record claimed all three rejection paths produced *distinct messages*. The
  // message existed but nothing pinned it.
  expect(res.json().error).toMatch(/already registered/i)
})

test('registration appends a project_registered event', async () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const a = buildApp({ db, bus })
  await a.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: makeTempRepo() } })
  expect(bus.since(null, 0).map((e) => e.type)).toContain('project_registered')
})

test('POST /api/projects defaults agentKind to claude-code, and honors an explicit codex', async () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const app = buildApp({ db, bus })

  const defaulted = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { repoPath: makeTempRepo() },
  })
  expect(defaulted.json().agentKind).toBe('claude-code')

  const explicit = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { repoPath: makeTempRepo(), agentKind: 'codex' },
  })
  expect(explicit.json().agentKind).toBe('codex')
})

test('a failed registration appends project_registration_failed with the reason', async () => {
  // Only the success path had event coverage, so the failure event could have
  // stopped firing without a single test noticing.
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const a = buildApp({ db, bus })
  await a.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: home } })

  const failed = bus.since(null, 0).find((e) => e.type === 'project_registration_failed')
  expect(failed).toBeDefined()
  expect(failed?.payload).toMatchObject({ repoPath: home })
  expect((failed?.payload as { message?: string } | undefined)?.message).toMatch(
    /not a git repository/i,
  )
})
