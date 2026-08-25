import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { objectives } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { worktreePathFor } from '../src/paths.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

async function withProject() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const app = buildApp({ db, bus: new EventBus(db) })
  const repo = makeTempRepo()
  const projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json().id as string
  const root = dirname(worktreePathFor(projectId, 'x'))
  return { app, db, repo, projectId, root }
}

/** A real registered worktree for `objectiveId`, with a row claiming it. */
function seedWorktree(
  db: ReturnType<typeof createDb>,
  repo: string,
  projectId: string,
  objectiveId: string,
): string {
  const path = worktreePathFor(projectId, objectiveId)
  mkdirSync(dirname(path), { recursive: true })
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', `vadd/${objectiveId}`, path], {
    stdio: 'pipe',
  })
  const now = new Date().toISOString()
  db.insert(objectives)
    .values({
      id: objectiveId,
      projectId,
      title: 'Fix the login redirect',
      goalText: 'g',
      status: 'paused',
      worktreePath: path,
      branchName: `vadd/${objectiveId}`,
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return path
}

const strays = async (app: Awaited<ReturnType<typeof withProject>>['app'], p: string) =>
  (await app.inject({ method: 'GET', url: `/api/projects/${p}/git/strays` })).json().strays as {
    kind: string
    path: string
    claim: { objectiveId: string } | null
  }[]

test('a healthy worktree is not reported', async () => {
  const { app, db, repo, projectId } = await withProject()
  seedWorktree(db, repo, projectId, 'aaaaaaaa')
  expect(await strays(app, projectId)).toEqual([])
})

test('a row pointing at a directory that is gone is reported as vanished', async () => {
  const { app, db, repo, projectId } = await withProject()
  const path = seedWorktree(db, repo, projectId, 'aaaaaaaa')
  // Deleted behind git's back, which is exactly how the live database got
  // four rows in this state.
  rmSync(path, { recursive: true, force: true })

  const out = await strays(app, projectId)
  expect(out).toHaveLength(1)
  expect(out[0]?.kind).toBe('vanished')
  expect(out[0]?.path).toBe(path)
  expect(out[0]?.claim?.objectiveId).toBe('aaaaaaaa')
})

test('a directory git no longer registers is reported as stranded', async () => {
  const { app, db, repo, projectId } = await withProject()
  const path = seedWorktree(db, repo, projectId, 'aaaaaaaa')
  // Deregister without deleting: remove the .git link file, then prune —
  // reproducing the phase 6 leak exactly rather than simulating it.
  rmSync(join(path, '.git'), { force: true })
  execFileSync('git', ['-C', repo, 'worktree', 'prune'], { stdio: 'pipe' })

  const out = await strays(app, projectId)
  expect(out).toHaveLength(1)
  expect(out[0]?.kind).toBe('stranded')
  expect(out[0]?.claim?.objectiveId).toBe('aaaaaaaa')
})

test('an unclaimed leftover directory is reported, which no git output can show', async () => {
  const { app, projectId, root } = await withProject()
  const path = join(root, 'left-behind')
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'vendor.bin'), 'x'.repeat(64))

  const out = await strays(app, projectId)
  expect(out).toEqual([{ kind: 'stranded', path, claim: null }])
})

test('a project that never made a worktree reports none, not an error', async () => {
  const { app, projectId } = await withProject()
  const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/git/strays` })
  expect(res.statusCode).toBe(200)
  expect(res.json().strays).toEqual([])
})

test('an unknown project is 404', async () => {
  const { app } = await withProject()
  const res = await app.inject({ method: 'GET', url: '/api/projects/nope/git/strays' })
  expect(res.statusCode).toBe(404)
})
