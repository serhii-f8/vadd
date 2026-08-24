import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { gitUndo, objectives } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { cloneOf, makeBareRemote } from './fixtures/bare-remote.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

async function withProject() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const app = buildApp({ db, bus: new EventBus(db) })
  const repo = makeTempRepo()
  const bare = makeBareRemote(repo)
  const projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json().id as string
  return { app, db, repo, bare, projectId }
}

const head = (dir: string, ref = 'HEAD') =>
  execFileSync('git', ['-C', dir, 'rev-parse', ref], { encoding: 'utf8' }).trim()

test('the remotes route reports what the repository has', async () => {
  const { app, bare, projectId } = await withProject()
  const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/git/remotes` })
  expect(res.statusCode).toBe(200)
  expect(res.json().remotes).toEqual([{ name: 'origin', fetchUrl: bare, pushUrl: bare }])
})

test('pushing through the route moves the ref on the remote', async () => {
  const { app, repo, bare, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/push`,
    payload: { worktree: repo, remote: 'origin', branch: 'master', setUpstream: true },
  })
  expect(res.statusCode).toBe(200)
  expect(head(bare, 'master')).toBe(head(repo))
})

test('pulling through the route fast-forwards the worktree', async () => {
  const { app, repo, bare, projectId } = await withProject()
  // Publish the starting point, then produce a commit somewhere else — the
  // only honest way to have something to pull, and all of it on local disk.
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'master'], { stdio: 'pipe' })
  const other = cloneOf(bare)
  writeFileSync(join(other, 'from-elsewhere.txt'), 'x\n')
  execFileSync('git', ['-C', other, 'add', '-A'], { stdio: 'pipe' })
  execFileSync('git', ['-C', other, 'commit', '-qm', 'elsewhere'], { stdio: 'pipe' })
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'master'], { stdio: 'pipe' })
  expect(head(repo)).not.toBe(head(other))

  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/pull`,
    payload: { worktree: repo, remote: 'origin' },
  })
  expect(res.statusCode).toBe(200)
  expect(head(repo)).toBe(head(other))
})

test('a push writes NO undo record', async () => {
  const { app, db, repo, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/push`,
    payload: { worktree: repo, remote: 'origin', branch: 'master', setUpstream: true },
  })
  // Asserted so the test cannot pass by the push never happening: a route
  // that 404s writes no undo record either.
  expect(res.statusCode).toBe(200)
  // The point of MutationKind.undoable. A record here would put an "Undo"
  // control on screen whose only effect is to desynchronize this repository
  // from the remote it just wrote to.
  expect(db.select().from(gitUndo).all()).toHaveLength(0)
})

/**
 * Every route that names a remote, with a body that is otherwise valid.
 *
 * Parametrised rather than copied because the guarantee is per-route: the
 * check lives in three separate handlers, so a test that exercises one of
 * them is evidence about one of them. Testing `fetch` alone left `pull`'s
 * guard deletable with the suite still green.
 */
const REMOTE_ROUTES = [
  { name: 'fetch', body: (_repo: string, remote: string) => ({ remote }) },
  { name: 'pull', body: (repo: string, remote: string) => ({ worktree: repo, remote }) },
  {
    name: 'push',
    body: (repo: string, remote: string) => ({
      worktree: repo,
      remote,
      branch: 'master',
      setUpstream: false,
    }),
  },
] as const

test('a remote that is not configured is refused with 400, on every route', async () => {
  const { app, repo, projectId } = await withProject()
  for (const route of REMOTE_ROUTES) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/git/${route.name}`,
      payload: route.body(repo, 'nope'),
    })
    expect(res.statusCode, route.name).toBe(400)
    expect(res.json().error, route.name).toMatch(/remote/i)
  }
})

test('a URL is not accepted as a remote, on every route', async () => {
  const { app, repo, projectId } = await withProject()
  // The mechanism amendment A20 rests on: there is no input through which
  // VADD can be pointed at a host the user did not configure. Each of the
  // three routes reaches `knownRemote` on its own line of code, so each of
  // them is asserted — a URL that got through any one of them would be
  // attempted for real.
  for (const route of REMOTE_ROUTES) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/git/${route.name}`,
      payload: route.body(repo, 'https://example.com/evil.git'),
    })
    expect(res.statusCode, route.name).toBe(400)
    expect(res.json().error, route.name).toMatch(/remote/i)
  }
})

test('an unknown branch is refused with 400', async () => {
  const { app, repo, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/push`,
    payload: { worktree: repo, remote: 'origin', branch: 'no-such', setUpstream: false },
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toMatch(/branch/i)
})

test('a busy objective refuses pull with 409 but permits fetch', async () => {
  const { app, db, projectId } = await withProject()
  const objective = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
  ).json()
  db.update(objectives).set({ status: 'executing' }).where(eq(objectives.id, objective.id)).run()

  const pulled = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/pull`,
    payload: { worktree: objective.worktreePath, remote: 'origin' },
  })
  expect(pulled.statusCode).toBe(409)
  expect(pulled.json().error).toContain('executing')

  // Fetch touches no local branch and no working tree, so there is nothing
  // for it to collide with and it is deliberately not gated.
  const fetched = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/fetch`,
    payload: { remote: 'origin' },
  })
  expect(fetched.statusCode).toBe(200)
})

test('a remote failure answers 502, not 500', async () => {
  const { app, repo, projectId } = await withProject()
  execFileSync('git', ['-C', repo, 'remote', 'set-url', 'origin', '/nonexistent/repo.git'], {
    stdio: 'pipe',
  })
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/fetch`,
    payload: { remote: 'origin' },
  })
  // "Your remote rejected this" and "VADD did something wrong" are different
  // facts and need different responses from the user.
  expect(res.statusCode).toBe(502)
})

test('a remote failure inside a gated mutation answers 502 too', async () => {
  const { app, repo, projectId } = await withProject()
  execFileSync('git', ['-C', repo, 'remote', 'set-url', 'origin', '/nonexistent/repo.git'], {
    stdio: 'pipe',
  })
  // The path that goes through `withGitMutation`, which stringifies whatever
  // `run` throws — the reason the status is carried on the error itself.
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/push`,
    payload: { worktree: repo, remote: 'origin', branch: 'master', setUpstream: false },
  })
  expect(res.statusCode).toBe(502)
})

test('a detached worktree is refused with 400 rather than pulling into HEAD', async () => {
  const { app, repo, projectId } = await withProject()
  execFileSync('git', ['-C', repo, 'checkout', '-q', '--detach'], { stdio: 'pipe' })
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/pull`,
    payload: { worktree: repo, remote: 'origin' },
  })
  // 400, not 502: nothing was asked of the remote, and the user is the one
  // who can fix it. This is the one RemoteError that overrides the default.
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toMatch(/detached/i)
})
