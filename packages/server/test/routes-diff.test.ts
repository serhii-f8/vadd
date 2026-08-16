import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { objectives } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

let db: Db
let app: ReturnType<typeof buildApp>
let repo: string
let projectId: string
let objectiveId: string
let worktreePath: string

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })
    .toString()
    .trim()

beforeEach(async () => {
  withTempHome()
  db = createDb(`${process.env.VADD_HOME}/vadd.db`)
  app = buildApp({ db, bus: new EventBus(db) })
  repo = makeTempRepo()
  projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json().id
  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: { title: 't', goalText: 'g' },
  })
  objectiveId = created.json().id
  worktreePath = created.json().worktreePath
})

describe('GET /api/objectives/:id/diff', () => {
  it('lists committed files with their line counts', async () => {
    writeFileSync(join(worktreePath, 'a.txt'), 'one\ntwo\n')
    git(worktreePath, 'add', '-A')
    git(worktreePath, 'commit', '-qm', 'vadd-checkpoint: task 1')

    const res = await app.inject({ method: 'GET', url: `/api/objectives/${objectiveId}/diff` })
    expect(res.statusCode).toBe(200)
    expect(res.json().files).toEqual([
      { path: 'a.txt', added: 2, removed: 0, committed: true, dirty: false },
    ])
    expect(res.json().totals).toEqual({ files: 1, added: 2, removed: 0 })
  })

  it('includes uncommitted and untracked files, marked dirty', async () => {
    writeFileSync(join(worktreePath, 'tracked.txt'), 'x\n')
    git(worktreePath, 'add', '-A')
    git(worktreePath, 'commit', '-qm', 'vadd-checkpoint: task 1')
    writeFileSync(join(worktreePath, 'tracked.txt'), 'x\ny\n')
    writeFileSync(join(worktreePath, 'brand-new.txt'), 'z\n')

    const files = (
      await app.inject({ method: 'GET', url: `/api/objectives/${objectiveId}/diff` })
    ).json().files as Array<{ path: string; dirty: boolean }>
    expect(files.map((f) => f.path).sort()).toEqual(['brand-new.txt', 'tracked.txt'])
    expect(files.every((f) => f.dirty)).toBe(true)
  })

  it('returns a unified diff for ?file=', async () => {
    writeFileSync(join(worktreePath, 'a.txt'), 'one\n')
    git(worktreePath, 'add', '-A')
    git(worktreePath, 'commit', '-qm', 'vadd-checkpoint: task 1')

    const res = await app.inject({
      method: 'GET',
      url: `/api/objectives/${objectiveId}/diff?file=a.txt`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toContain('+one')
  })

  it('404s for a ?file= that is not in the list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objectives/${objectiveId}/diff?file=../../etc/passwd`,
    })
    expect(res.statusCode).toBe(404)
  })

  it('409s once the worktree is gone', async () => {
    db.update(objectives).set({ worktreePath: null }).where(eq(objectives.id, objectiveId)).run()
    const res = await app.inject({ method: 'GET', url: `/api/objectives/${objectiveId}/diff` })
    expect(res.statusCode).toBe(409)
  })
})
