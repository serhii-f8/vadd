import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
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

function seedWorktree(
  db: ReturnType<typeof createDb>,
  repo: string,
  projectId: string,
  objectiveId: string,
  status = 'paused',
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
      status,
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

/** Deregisters a worktree without deleting it — the phase 6 leak, reproduced. */
function strand(repo: string, path: string) {
  rmSync(join(path, '.git'), { force: true })
  execFileSync('git', ['-C', repo, 'worktree', 'prune'], { stdio: 'pipe' })
}

const release = (
  app: Awaited<ReturnType<typeof withProject>>['app'],
  projectId: string,
  path: string,
) =>
  app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/release`,
    payload: { path },
  })

test('releasing a vanished row nulls its columns and deletes nothing', async () => {
  const { app, db, repo, projectId, root } = await withProject()
  const path = seedWorktree(db, repo, projectId, 'aaaaaaaa')
  rmSync(path, { recursive: true, force: true })
  // A sibling that must survive: if the vanished branch ever reaches the
  // delete, this is what notices.
  const sibling = join(root, 'not-mine')
  mkdirSync(sibling, { recursive: true })

  const res = await release(app, projectId, path)
  expect(res.statusCode).toBe(200)

  const row = db.select().from(objectives).where(eq(objectives.id, 'aaaaaaaa')).get()
  expect(row?.worktreePath).toBeNull()
  expect(row?.branchName).toBeNull()
  expect(existsSync(sibling)).toBe(true)
})

test('releasing a stranded directory deletes it from disk', async () => {
  const { app, db, repo, projectId } = await withProject()
  const path = seedWorktree(db, repo, projectId, 'aaaaaaaa')
  strand(repo, path)
  expect(existsSync(path)).toBe(true)

  const res = await release(app, projectId, path)
  expect(res.statusCode).toBe(200)
  // Checked directly, not through the route's own report: a route that
  // reports success without looking at disk is the removeWorktree defect.
  expect(existsSync(path)).toBe(false)

  const row = db.select().from(objectives).where(eq(objectives.id, 'aaaaaaaa')).get()
  expect(row?.worktreePath).toBeNull()
})

test('releasing an unclaimed stranded directory needs no objective', async () => {
  const { app, projectId, root } = await withProject()
  const path = join(root, 'left-behind')
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'vendor.bin'), 'x')

  const res = await release(app, projectId, path)
  expect(res.statusCode).toBe(200)
  expect(existsSync(path)).toBe(false)
})

test('a busy objective blocks a stranded release with 409 naming the state', async () => {
  const { app, db, repo, projectId } = await withProject()
  const path = seedWorktree(db, repo, projectId, 'aaaaaaaa', 'executing')
  strand(repo, path)

  const res = await release(app, projectId, path)
  expect(res.statusCode).toBe(409)
  expect(res.json().error).toContain('executing')
  expect(res.json().objectiveId).toBe('aaaaaaaa')
  // The gate exists to stop exactly this: a live agent's files deleted
  // underneath it.
  expect(existsSync(path)).toBe(true)
})

test('a busy objective does NOT block a vanished release', async () => {
  const { app, db, repo, projectId } = await withProject()
  const path = seedWorktree(db, repo, projectId, 'aaaaaaaa', 'executing')
  rmSync(path, { recursive: true, force: true })

  // There is no directory for the gate to protect, and gating here would make
  // the objective unrepairable without abandon — a deadlock the gate creates
  // rather than prevents.
  const res = await release(app, projectId, path)
  expect(res.statusCode).toBe(200)
  const row = db.select().from(objectives).where(eq(objectives.id, 'aaaaaaaa')).get()
  expect(row?.worktreePath).toBeNull()
})

test('a healthy worktree is not releasable', async () => {
  const { app, db, repo, projectId } = await withProject()
  const path = seedWorktree(db, repo, projectId, 'aaaaaaaa')

  const res = await release(app, projectId, path)
  expect(res.statusCode).toBe(400)
  expect(existsSync(path)).toBe(true)
})

test('a path outside the project worktree root is refused', async () => {
  const { app, projectId } = await withProject()
  // Would be destructive if it got through: a real directory with a real file.
  const outside = makeTempRepo()
  const res = await release(app, projectId, outside)
  expect(res.statusCode).toBe(400)
  expect(existsSync(outside)).toBe(true)
})

test('a missing path body is refused', async () => {
  const { app, projectId } = await withProject()
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/git/release`,
    payload: {},
  })
  expect(res.statusCode).toBe(400)
})

test('a delete that cannot complete fails loudly instead of reporting success', async () => {
  const { app, projectId, root } = await withProject()
  const path = join(root, 'undeletable')
  mkdirSync(join(path, 'inner'), { recursive: true })
  writeFileSync(join(path, 'inner', 'file.txt'), 'x')
  // Unlink is authorised by the containing directory, not the file, so a
  // read-only parent makes the child undeletable without needing root.
  chmodSync(join(path, 'inner'), 0o555)

  try {
    const res = await release(app, projectId, path)
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toMatch(/still on disk|permission/i)
    expect(existsSync(path)).toBe(true)
  } finally {
    chmodSync(join(path, 'inner'), 0o755)
  }
})
