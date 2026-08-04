import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
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

  expect(o.status).toBe('ready')
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

  const res = await app.inject({
    method: 'POST',
    url: `/api/objectives/${o.id}/events`,
    payload: { type: 'integrate', action: 'discard' },
  })
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
  await app.inject({
    method: 'POST',
    url: `/api/objectives/${o.id}/events`,
    payload: { type: 'integrate', action: 'discard' },
  })
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
