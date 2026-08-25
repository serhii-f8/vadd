import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { objectives } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

async function withProject() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const app = buildApp({ db, bus })
  const repo = makeTempRepo()
  const projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json().id as string
  return { app, db, repo, projectId }
}

async function makeObjective(app: Awaited<ReturnType<typeof withProject>>['app'], p: string) {
  return (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${p}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
  ).json()
}

test('staging then committing through the routes produces a commit', async () => {
  const { app, repo, projectId } = await withProject()
  writeFileSync(join(repo, 'new.txt'), 'x\n')

  const staged = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/stage`,
    payload: { worktree: repo, paths: ['new.txt'] },
  })
  expect(staged.statusCode).toBe(200)

  const committed = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/commit`,
    payload: { worktree: repo, message: 'from the route' },
  })
  expect(committed.statusCode).toBe(200)

  const subject = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], {
    encoding: 'utf8',
  }).trim()
  expect(subject).toBe('from the route')
})

test('a worktree outside this project is refused with 400', async () => {
  const { app, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/stage`,
    payload: { worktree: '/etc', paths: ['passwd'] },
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toContain('worktree')
})

test('a path outside the worktree is refused with 400', async () => {
  const { app, repo, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/stage`,
    payload: { worktree: repo, paths: ['../../etc/passwd'] },
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toMatch(/path/i)
})

test('a non-sha squash bound is refused with 400', async () => {
  const { app, repo, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/squash`,
    payload: { worktree: repo, from: '--all', to: 'HEAD', message: 'x' },
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toMatch(/sha/i)
})

test('a busy objective is refused with 409 naming the state', async () => {
  const { app, db, projectId } = await withProject()
  const objective = await makeObjective(app, projectId)
  // Force the busy state directly; driving a real agent turn is not this
  // test's subject.
  db.update(objectives).set({ status: 'executing' }).where(eq(objectives.id, objective.id)).run()

  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/commit`,
    payload: { worktree: objective.worktreePath, message: 'x' },
  })
  expect(res.statusCode).toBe(409)
  expect(res.json().error).toContain('executing')
})

test('undo restores the pre-operation sha', async () => {
  const { app, repo, projectId } = await withProject()
  const before = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()

  writeFileSync(join(repo, 'new.txt'), 'x\n')
  await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/stage`,
    payload: { worktree: repo, paths: ['new.txt'] },
  })
  await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/commit`,
    payload: { worktree: repo, message: 'undo me' },
  })
  // The commit must really have moved HEAD, or the undo below would "restore"
  // a sha the repository never left and the test could not fail.
  expect(
    execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  ).not.toBe(before)

  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/undo`,
    payload: { worktree: repo },
  })
  expect(res.statusCode).toBe(200)

  const after = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  expect(after).toBe(before)
})

test('undo with no record is refused rather than silently doing nothing', async () => {
  const { app, repo, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/undo`,
    payload: { worktree: repo },
  })
  expect(res.statusCode).toBe(404)
  // The message is asserted, not just the status. Fastify answers an
  // unregistered route with 404 too, so a status-only assertion passes
  // against a route that does not exist — which is precisely the
  // "several paths produce the same status" defect Pass A shipped and had
  // to fix.
  expect(res.json().error).toMatch(/undo/i)
})

test('switching an objective branch is refused with 403', async () => {
  const { app, repo, projectId } = await withProject()
  const objective = await makeObjective(app, projectId)
  execFileSync('git', ['-C', repo, 'branch', 'other'], { stdio: 'pipe' })

  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/checkout`,
    payload: { worktree: objective.worktreePath, branch: 'other' },
  })
  expect(res.statusCode).toBe(403)
  expect(res.json().error).toMatch(/branch/i)
})

test('an unreadable verification spec refuses the mutation rather than emptying the globs', async () => {
  const { app, db, projectId } = await withProject()
  const objective = await makeObjective(app, projectId)
  // Present, but not a `VerificationSpec`: `setup`/`commands`/`checks` at the
  // top level instead of nested under `verify`. Written by hand while
  // hand-verifying the git surface, and the reason this test exists — the
  // parse failed, the globs silently became `[]`, and a protected file was
  // committed reporting `excludedPaths: []`.
  db.update(objectives)
    .set({ verificationSpec: { setup: [], commands: [], checks: [] } })
    .where(eq(objectives.id, objective.id))
    .run()

  writeFileSync(join(objective.worktreePath as string, 'new.txt'), 'x\n')
  await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/stage`,
    payload: { worktree: objective.worktreePath, paths: ['new.txt'] },
  })
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/commit`,
    payload: { worktree: objective.worktreePath, message: 'x' },
  })
  expect(res.statusCode).toBe(500)
  expect(res.json().error).toMatch(/verification spec/i)

  // Refused, not merely reported: the commit must not exist.
  const subject = execFileSync(
    'git',
    ['-C', objective.worktreePath as string, 'log', '-1', '--format=%s'],
    { encoding: 'utf8' },
  ).trim()
  expect(subject).not.toBe('x')
})
