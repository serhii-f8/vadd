import { execFileSync } from 'node:child_process'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { makeBareRemote } from './fixtures/bare-remote.js'
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
  // `--output=/tmp/pwned` is a genuine injection probe, not just an arbitrary
  // bad string: it is a *valid* git option and would exit 0 if this ever
  // reached a real git argv unguarded. A nonexistent branch name would also
  // 400, but only because `readLog`'s own reachability check throws a
  // `GitError` on a different code path — a status-code-only assertion is
  // satisfied either way and does not prove this route's own branch-list
  // guard exists at all.
  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/log?ref=${encodeURIComponent('--output=/tmp/pwned')}`,
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toContain('Not a branch')
  expect(existsSync('/tmp/pwned')).toBe(false)
})

test('the log route refuses a before cursor that is not a sha', async () => {
  const { app, projectId } = await withProject()
  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/log?before=${encodeURIComponent('--all')}`,
  })
  expect(res.statusCode).toBe(400)
  // Asserting the exact message, not just the status code, pins the
  // shape guard itself: readLog's own reachability check also produces a
  // 400 on a malformed cursor (via the GitError catch below), with a
  // different, dynamic message — so a status-code-only assertion is
  // satisfied by either code path and does not prove this guard exists.
  expect(res.json().error).toBe('before must be a commit sha')
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

test('the status route requires a worktree parameter', async () => {
  const { app, projectId } = await withProject()
  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/status`,
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('worktree is required')
})

test('the log route falls back to the default limit on a non-numeric limit', async () => {
  const { app, repo, projectId } = await withProject()
  for (let n = 0; n < 5; n++) {
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', `c${n}`], {
      stdio: 'pipe',
    })
  }

  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/log?limit=abc`,
  })
  expect(res.statusCode).toBe(200)
  // 6 real commits (5 here + makeTempRepo's own 'init'), well under the
  // default of 50 — proves the fallback, not a coincidental clamp.
  expect(res.json().commits).toHaveLength(6)
  expect(res.json().hasMore).toBe(false)
})

test('the log route clamps a limit above the maximum', async () => {
  const { app, repo, projectId } = await withProject()
  // More than MAX_LIMIT (200) commits, so an unclamped `limit=999999` would
  // be observably distinguishable from a clamped one: exactly 200 back with
  // hasMore true, not "however many real commits exist".
  for (let n = 0; n < 203; n++) {
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', `c${n}`], {
      stdio: 'pipe',
    })
  }

  const res = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/git/log?limit=999999`,
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().commits).toHaveLength(200)
  expect(res.json().hasMore).toBe(true)
}, 20000)

test('the log route clamps a zero or negative limit up to 1', async () => {
  const { app, repo, projectId } = await withProject()
  for (let n = 0; n < 5; n++) {
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', `c${n}`], {
      stdio: 'pipe',
    })
  }

  const zero = (
    await app.inject({ method: 'GET', url: `/api/projects/${projectId}/git/log?limit=0` })
  ).json()
  expect(zero.commits).toHaveLength(1)
  expect(zero.hasMore).toBe(true)

  const negative = (
    await app.inject({ method: 'GET', url: `/api/projects/${projectId}/git/log?limit=-5` })
  ).json()
  expect(negative.commits).toHaveLength(1)
  expect(negative.hasMore).toBe(true)
})

test('the topology route reports ahead/behind for a tracked branch', async () => {
  const { app, repo, projectId } = await withProject()
  makeBareRemote(repo)
  execFileSync('git', ['-C', repo, 'push', '-qu', 'origin', 'master'], { stdio: 'pipe' })
  writeFileSync(join(repo, 'mine.txt'), 'y\n')
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'mine'], { stdio: 'pipe' })

  const body = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/git` })).json()
  const master = body.branches.find((b: { name: string }) => b.name === 'master')
  expect(master.ahead).toBe(1)
  expect(master.behind).toBe(0)
})

test('the topology route degrades to null ahead/behind rather than 500ing when one branch cannot be computed', async () => {
  const { app, repo, projectId } = await withProject()
  execFileSync('git', ['-C', repo, 'branch', 'untracked-branch'], { stdio: 'pipe' })
  makeBareRemote(repo)
  execFileSync('git', ['-C', repo, 'push', '-qu', 'origin', 'master'], { stdio: 'pipe' })

  // Corrupt the remote-tracking ref's own object rather than remove the ref
  // or its branch config: `rev-parse ...@{upstream}` is a pure ref-name
  // lookup and still resolves ("origin/master") without needing the object,
  // but `rev-list`, which must actually walk the commit, then fails — the
  // one failure mode `aheadBehind`'s original guard (wrapping only
  // `rev-parse`) did not cover. Deleting the ref outright, or leaving stale
  // `branch.*.remote`/`branch.*.merge` config, both fail at the `rev-parse`
  // step instead, which was already safe before this fix.
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'refs/remotes/origin/master'], {
    encoding: 'utf8',
  }).trim()
  unlinkSync(join(repo, '.git', 'objects', sha.slice(0, 2), sha.slice(2)))

  const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/git` })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.branches.map((b: { name: string }) => b.name).sort()).toEqual([
    'master',
    'untracked-branch',
  ])
  const master = body.branches.find((b: { name: string }) => b.name === 'master')
  expect(master.ahead).toBeNull()
  expect(master.behind).toBeNull()
})
