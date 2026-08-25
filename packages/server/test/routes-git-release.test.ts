import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { events, objectives } from '../src/db/schema.js'
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
  const { app, db, projectId } = await withProject()
  // A claimed path outside VADD's own root. `findStrays` marks any claimed
  // path absent from `onDisk` as `vanished`, and `onDisk` only ever holds
  // children of `readdir(worktreeRoot)` — a path outside the root can never
  // be in it, existing or not, so this row reads as `vanished` regardless. A
  // `stranded` path can never exercise this guard on its own: it is
  // discovered BY a `readdir` of the root, so it is always inside it. This
  // is the one shape where guard 1 (strays-list membership) passes and guard
  // 2 (`isUnder`) is the only thing left refusing the request.
  const outside = makeTempRepo()
  const now = new Date().toISOString()
  db.insert(objectives)
    .values({
      id: 'bbbbbbbb',
      projectId,
      title: 'Somewhere else entirely',
      goalText: 'g',
      status: 'paused',
      worktreePath: outside,
      branchName: 'vadd/bbbbbbbb',
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const res = await release(app, projectId, outside)
  expect(res.statusCode).toBe(400)
  // Refused, not quietly repaired: the row must be untouched.
  const row = db.select().from(objectives).where(eq(objectives.id, 'bbbbbbbb')).get()
  expect(row?.worktreePath).toBe(outside)
  // `vanished` strays are never deleted from disk regardless of this guard —
  // kept as belt-and-suspenders proof nothing here touches the filesystem.
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

// What this pins is the outward contract, not a specific internal branch:
// an undeletable directory 500s with a diagnosable error and is left in
// place, never reported as released. On THIS fixture that 500 comes from
// `rm`'s own `catch` — `fs.rm({ force: true })` throws on a real EACCES
// (`force` only swallows ENOENT), so the `existsSync` post-condition a few
// lines below it is never reached here. That check still exists for a
// silent-success mode `fs.rm` has not been observed to produce but
// `removeWorktree` did — see the comment on it in the route.
test('a delete that cannot complete fails loudly instead of reporting success', async () => {
  const { app, db, projectId, root } = await withProject()
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
    // The one route that can leave the disk mutated with zero trace in the
    // events table, unless this fires: every `withGitMutation`-wrapped
    // mutation emits `git_mutation_failed` on its own failure path
    // (`mutate.ts`); this route isn't wrapped by it, so it has to emit the
    // same shape by hand. This fixture's 500 comes from the `catch` branch
    // (see the comment above it) — the `existsSync` post-condition's own
    // `git_mutation_failed` emission has no fixture that reaches it, for the
    // same reason its 500 has none.
    const failures = db.select().from(events).where(eq(events.type, 'git_mutation_failed')).all()
    expect(failures).toHaveLength(1)
    expect((failures[0]?.payload as { message?: string } | undefined)?.message).toMatch(
      /permission|EACCES/i,
    )
  } finally {
    chmodSync(join(path, 'inner'), 0o755)
  }
})

test('a vanished row whose path is actually present on disk is refused, not repaired', async () => {
  const { app, db, projectId, root } = await withProject()
  const path = join(root, 'aaaaaaaa')
  mkdirSync(root, { recursive: true })
  // `readdir`'s filter in `strays.ts` accepts a directory or a symlink (see
  // its comment) — deliberately widened by this same review, since a
  // symlink-relocated worktree used to be invisible to it and read
  // `vanished`. That fix closes the symlink shape of this bug at the source,
  // so a plain symlink no longer reaches this branch at all: it is now
  // correctly seen and classified healthy or `stranded` instead. A regular
  // file — neither a directory nor a symlink — is the fixture that still
  // demonstrates the residual case this guard exists for: `readdir` cannot
  // see it as a worktree, `findStrays` classifies the claim `vanished`, and
  // yet the path genuinely exists on disk.
  writeFileSync(path, 'not actually gone')
  const now = new Date().toISOString()
  db.insert(objectives)
    .values({
      id: 'aaaaaaaa',
      projectId,
      title: 'Fix the login redirect',
      goalText: 'g',
      status: 'paused',
      worktreePath: path,
      branchName: 'vadd/aaaaaaaa',
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const res = await release(app, projectId, path)
  expect(res.statusCode).toBe(409)
  expect(res.json().error).toContain('on disk after all')

  const row = db.select().from(objectives).where(eq(objectives.id, 'aaaaaaaa')).get()
  expect(row?.worktreePath).toBe(path)
  expect(row?.branchName).toBe('vadd/aaaaaaaa')
  expect(existsSync(path)).toBe(true)
})
