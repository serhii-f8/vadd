import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
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
  return { app, db, home, repo, projectId }
}

test('the topology route reports branches and worktrees with provenance', async () => {
  const { app, repo, projectId } = await withProject()
  execFileSync('git', ['-C', repo, 'branch', 'feature/login'], { stdio: 'pipe' })

  const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/git` })
  expect(res.statusCode).toBe(200)
  const body = res.json()

  expect(body.mainRepoPath).toBe(repo)
  expect(typeof body.currentBranch).toBe('string')
  expect(body.branches.find((b: { name: string }) => b.name === 'feature/login').owner).toEqual({
    kind: 'user',
  })
  expect(body.worktrees).toHaveLength(1)
  expect(body.worktrees[0].isMain).toBe(true)
})

test("an objective's own branch and worktree are reported as VADD's", async () => {
  const { app, projectId } = await withProject()
  const objective = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 'Fix the login redirect', goalText: 'g' },
    })
  ).json()

  const body = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/git` })).json()
  const branch = body.branches.find((b: { name: string }) => b.name === objective.branchName)
  expect(branch.owner).toMatchObject({
    kind: 'vadd',
    objectiveId: objective.id,
    objectiveTitle: 'Fix the login redirect',
  })
  const wt = body.worktrees.find((w: { path: string }) => w.path === objective.worktreePath)
  expect(wt.owner).toMatchObject({ kind: 'vadd', objectiveId: objective.id })
})

test('the log route pages and reports whether more remain', async () => {
  const { app, repo, projectId } = await withProject()
  for (const n of [1, 2, 3]) {
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', `c${n}`], {
      stdio: 'pipe',
    })
  }

  const first = (
    await app.inject({ method: 'GET', url: `/api/projects/${projectId}/git/log?limit=2` })
  ).json()
  expect(first.commits).toHaveLength(2)
  expect(first.hasMore).toBe(true)

  const cursor = first.commits[1].sha
  const second = (
    await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/git/log?limit=50&before=${cursor}`,
    })
  ).json()
  expect(second.commits.map((c: { sha: string }) => c.sha)).not.toContain(cursor)
  expect(second.hasMore).toBe(false)
})

test('the status route counts the working tree of a worktree this project owns', async () => {
  const { app, repo, projectId } = await withProject()
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'x'], { stdio: 'pipe' })

  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/status?worktree=${encodeURIComponent(repo)}`,
  })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ staged: 0, unstaged: 0, untracked: 0 })
})

test('the status route refuses a worktree this project does not have', async () => {
  const { app, projectId } = await withProject()
  // Unvalidated, this parameter is an arbitrary-directory read on the user's
  // machine. Localhost and no auth (spec §7) is a decision about who can
  // reach the server, not a licence for it to read anywhere it is asked.
  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/status?worktree=${encodeURIComponent('/etc')}`,
  })
  expect(res.statusCode).toBe(400)
})

test('the log route refuses a ref that is not a branch of this repo', async () => {
  const { app, projectId } = await withProject()
  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/log?ref=${encodeURIComponent('--output=/tmp/pwned')}`,
  })
  expect(res.statusCode).toBe(400)
})

test('the log route refuses a before cursor that is not a sha', async () => {
  const { app, projectId } = await withProject()
  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/log?before=${encodeURIComponent('--all')}`,
  })
  expect(res.statusCode).toBe(400)
})

test('every git route 404s for an unknown project', async () => {
  const { app } = await withProject()
  for (const path of ['git', 'git/log', 'git/status?worktree=/tmp']) {
    const res = await app.inject({ method: 'GET', url: `/api/projects/nope/${path}` })
    expect(res.statusCode).toBe(404)
  }
})

test('the log route rejects an unreachable but syntactically valid cursor with 400, not 500', async () => {
  const { app, projectId } = await withProject()
  const fakeSha = 'a'.repeat(40)
  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/log?before=${fakeSha}`,
  })
  expect(res.statusCode).toBe(400)
})
