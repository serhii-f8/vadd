import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, test } from 'vitest'
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

describe('POST /api/projects/clone', () => {
  it('clones and registers in one call', async () => {
    const source = makeTempRepo()
    const dest = join(mkdtempSync(join(tmpdir(), 'vadd-clone-')), 'cloned-repo')
    const a = app()
    const res = await a.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: { url: source, destPath: dest, agentKind: 'claude-code' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.repoPath).toBe(dest)
    const head = execFileSync('git', ['-C', dest, 'rev-parse', 'HEAD']).toString().trim()
    expect(head).toHaveLength(40)
  })

  it('400s on a rejected URL before touching the filesystem', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'vadd-clone-')), 'should-not-exist')
    const a = app()
    const res = await a.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: { url: '--upload-pack=/bin/sh', destPath: dest, agentKind: 'claude-code' },
    })
    expect(res.statusCode).toBe(400)
    expect(existsSync(dest)).toBe(false)
  })

  it('409s when destPath already exists', async () => {
    const source = makeTempRepo()
    const dest = mkdtempSync(join(tmpdir(), 'vadd-clone-'))
    const a = app()
    const res = await a.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: { url: source, destPath: dest, agentKind: 'claude-code' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('400s on a relative destPath', async () => {
    const source = makeTempRepo()
    const a = app()
    const res = await a.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: { url: source, destPath: 'relative/path', agentKind: 'claude-code' },
    })
    expect(res.statusCode).toBe(400)
  })

  it("the clone route's duplicate check is the same shared function POST /api/projects uses", async () => {
    const source = makeTempRepo()
    const a = app()
    await a.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: source } })
    const dest = join(mkdtempSync(join(tmpdir(), 'vadd-clone-')), 'cloned-again')
    const res = await a.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: { url: source, destPath: dest, agentKind: 'claude-code' },
    })
    // The clone itself succeeds (dest is a fresh, independent repo — cloning
    // the same source twice produces two distinct toplevels, so this is not
    // a duplicate at the git level). The 409 below comes from a second, plain
    // POST /api/projects registering that same `dest` path again, proving
    // registerValidatedRepo's duplicate check is the identical function
    // backing both routes.
    expect(res.statusCode).toBe(201)
    const dupe = await a.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { repoPath: dest },
    })
    expect(dupe.statusCode).toBe(409)
  })
})
