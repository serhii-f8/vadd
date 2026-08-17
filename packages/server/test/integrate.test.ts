import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { objectives, projects } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { createWorktree } from '../src/git/git-manager.js'
import { runIntegration } from '../src/workflow/integrate.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

let db: Db
let bus: EventBus
let repo: string
let home: string

beforeEach(() => {
  home = withTempHome()
  db = createDb(`${home}/vadd.db`)
  bus = new EventBus(db)
  repo = makeTempRepo()
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })
    .toString()
    .trim()

/** Creates a real worktree with two `vadd-checkpoint:` commits and returns the rows. */
async function seed(title = 'Fix the thing') {
  const now = new Date().toISOString()
  db.insert(projects)
    .values({ id: 'p1', name: 'p', repoPath: repo, config: {}, createdAt: now })
    .run()
  const wt = join(home, 'wt')
  const baseSha = await createWorktree(repo, wt, 'vadd/abc12345')

  writeFileSync(join(wt, 'a.txt'), 'one\n')
  git(wt, 'add', '-A')
  git(wt, 'commit', '-qm', 'vadd-checkpoint: task 1')
  writeFileSync(join(wt, 'b.txt'), 'two\n')
  git(wt, 'add', '-A')
  git(wt, 'commit', '-qm', 'vadd-checkpoint: task 2')

  db.insert(objectives)
    .values({
      id: 'o1',
      projectId: 'p1',
      title,
      goalText: 'the goal',
      status: 'integrating',
      worktreePath: wt,
      branchName: 'vadd/abc12345',
      baseSha,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const project = db.select().from(projects).where(eq(projects.id, 'p1')).get()
  const objective = db.select().from(objectives).where(eq(objectives.id, 'o1')).get()
  if (!project || !objective) throw new Error('seed failed')
  return { project, objective, wt, baseSha }
}

describe('runIntegration: commit', () => {
  it('squashes every checkpoint into exactly one commit off baseSha', async () => {
    const { project, objective, baseSha } = await seed()
    const out = await runIntegration({ db, bus }, objective, project, 'commit')
    expect(out).toEqual({ ok: true, committed: true })

    const log = git(repo, 'log', '--format=%s', `${baseSha}..vadd/abc12345`).split('\n')
    expect(log).toEqual(['Fix the thing'])
    expect(git(repo, 'log', '-1', '--format=%b', 'vadd/abc12345')).toContain('the goal')
  })

  it('carries uncommitted working-tree changes into the squash', async () => {
    const { project, objective, wt, baseSha } = await seed()
    writeFileSync(join(wt, 'c.txt'), 'three\n')
    await runIntegration({ db, bus }, objective, project, 'commit')
    const files = git(repo, 'diff', '--name-only', `${baseSha}..vadd/abc12345`).split('\n')
    expect(files.sort()).toEqual(['a.txt', 'b.txt', 'c.txt'])
  })

  it('removes the worktree but keeps the branch, and nulls worktreePath', async () => {
    const { project, objective } = await seed()
    await runIntegration({ db, bus }, objective, project, 'commit')
    expect(git(repo, 'branch', '--list', 'vadd/abc12345')).toContain('vadd/abc12345')
    expect(git(repo, 'worktree', 'list')).not.toContain('vadd/abc12345')
    const row = db.select().from(objectives).where(eq(objectives.id, 'o1')).get()
    expect(row?.worktreePath).toBeNull()
    expect(row?.branchName).toBe('vadd/abc12345')
  })

  it('emits integrate_empty and commits nothing when there is no diff', async () => {
    const now = new Date().toISOString()
    db.insert(projects)
      .values({ id: 'p1', name: 'p', repoPath: repo, config: {}, createdAt: now })
      .run()
    const wt = join(home, 'wt')
    const baseSha = await createWorktree(repo, wt, 'vadd/empty123')
    db.insert(objectives)
      .values({
        id: 'o1',
        projectId: 'p1',
        title: 'Nothing changed',
        goalText: 'g',
        status: 'integrating',
        worktreePath: wt,
        branchName: 'vadd/empty123',
        baseSha,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    const project = db.select().from(projects).where(eq(projects.id, 'p1')).get()
    const objective = db.select().from(objectives).where(eq(objectives.id, 'o1')).get()
    if (!project || !objective) throw new Error('seed failed')

    const out = await runIntegration({ db, bus }, objective, project, 'commit')
    expect(out).toEqual({ ok: true, committed: false })
    expect(bus.since('o1', 0).map((e) => e.type)).toContain('integrate_empty')
    expect(git(repo, 'log', '--format=%s', `${baseSha}..vadd/empty123`)).toBe('')
  })

  it('reports a failure without claiming success when the base sha is unknown', async () => {
    const { project } = await seed()
    db.update(objectives).set({ baseSha: 'notasha' }).where(eq(objectives.id, 'o1')).run()
    const stale = db.select().from(objectives).where(eq(objectives.id, 'o1')).get()
    if (!stale) throw new Error('missing row')
    const out = await runIntegration({ db, bus }, stale, project, 'commit')
    expect(out.ok).toBe(false)
    // The worktree must survive a failure — the user has to be able to retry.
    expect(git(repo, 'worktree', 'list')).toContain('wt')
  })
})

describe('runIntegration: keep', () => {
  it('touches no git state at all', async () => {
    const { project, objective, baseSha } = await seed()
    const before = git(repo, 'log', '--format=%s', `${baseSha}..vadd/abc12345`)
    const out = await runIntegration({ db, bus }, objective, project, 'keep')
    expect(out).toEqual({ ok: true, committed: false })
    expect(git(repo, 'log', '--format=%s', `${baseSha}..vadd/abc12345`)).toBe(before)
    expect(git(repo, 'worktree', 'list')).toContain('wt')
    expect(
      db.select().from(objectives).where(eq(objectives.id, 'o1')).get()?.worktreePath,
    ).not.toBeNull()
  })
})

describe('runIntegration: discard', () => {
  it('removes the worktree and the branch, and keeps every row', async () => {
    const { project, objective } = await seed()
    const out = await runIntegration({ db, bus }, objective, project, 'discard')
    expect(out).toEqual({ ok: true, committed: false })
    expect(git(repo, 'branch', '--list', 'vadd/abc12345')).toBe('')
    expect(git(repo, 'worktree', 'list')).not.toContain('wt')

    const row = db.select().from(objectives).where(eq(objectives.id, 'o1')).get()
    expect(row).toBeDefined()
    expect(row?.worktreePath).toBeNull()
    expect(row?.branchName).toBeNull()
  })
})

/**
 * Amendment A1's `setup` commands run real shell inside the worktree, and the
 * exit run's did what the `flexpick.net` trap says it must: rewrote the
 * *tracked* `backend/.env.testing` so the suite talks to host-exposed ports
 * instead of Sail's. Every `vadd-checkpoint:` commit swept that up with
 * `git add -A`, and the squash carried it onto the branch. `protectedGlobs`
 * named the file and stopped nothing, because until now nothing read the field.
 */
describe('runIntegration: commit and policy.protectedGlobs', () => {
  const SPEC = {
    verify: { setup: [], commands: [], checks: [], timeoutSec: 600 },
    policy: {
      protectedGlobs: ['backend/.env*', 'backend/vendor/**', '**/migrations/**'],
      maxFastFixLines: 150,
    },
  }

  /** A repo with a tracked `backend/.env.testing`, and a worktree that changed it. */
  async function seedProtected(spec: unknown = SPEC) {
    const now = new Date().toISOString()
    mkdirSync(join(repo, 'backend'), { recursive: true })
    writeFileSync(join(repo, 'backend/.env.testing'), 'DB_HOST=mysql\nDB_PORT=3306\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'add env')

    db.insert(projects)
      .values({ id: 'p1', name: 'p', repoPath: repo, config: {}, createdAt: now })
      .run()
    const wt = join(home, 'wt')
    const baseSha = await createWorktree(repo, wt, 'vadd/prot1234')

    // What `setup` did: a tracked file rewritten for the host, plus a vendored
    // tree and a migration nobody asked this objective to touch.
    writeFileSync(join(wt, 'backend/.env.testing'), 'DB_HOST=127.0.0.1\nDB_PORT=33061\n')
    mkdirSync(join(wt, 'backend/vendor'), { recursive: true })
    writeFileSync(join(wt, 'backend/vendor/autoload.php'), '<?php // installed\n')
    mkdirSync(join(wt, 'backend/database/migrations'), { recursive: true })
    writeFileSync(join(wt, 'backend/database/migrations/0001_x.php'), '<?php // schema\n')
    // The actual fix.
    mkdirSync(join(wt, 'backend/app'), { recursive: true })
    writeFileSync(join(wt, 'backend/app/Collector.php'), '<?php // the bugfix\n')
    git(wt, 'add', '-A')
    git(wt, 'commit', '-qm', 'vadd-checkpoint: task 1')

    db.insert(objectives)
      .values({
        id: 'o1',
        projectId: 'p1',
        title: 'Fix the collector',
        goalText: 'the goal',
        status: 'integrating',
        worktreePath: wt,
        branchName: 'vadd/prot1234',
        baseSha,
        verificationSpec: spec as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    const project = db.select().from(projects).where(eq(projects.id, 'p1')).get()
    const objective = db.select().from(objectives).where(eq(objectives.id, 'o1')).get()
    if (!project || !objective) throw new Error('seed failed')
    return { project, objective, wt, baseSha }
  }

  it('keeps protected paths out of the squashed commit', async () => {
    const { project, objective, baseSha } = await seedProtected()
    const out = await runIntegration({ db, bus }, objective, project, 'commit')
    expect(out).toEqual({ ok: true, committed: true })

    const files = git(repo, 'diff', '--name-only', `${baseSha}..vadd/prot1234`).split('\n')
    expect(files).toEqual(['backend/app/Collector.php'])
    // The tracked file is not merely absent from the diff — the committed tree
    // still holds the repo's own version of it.
    expect(git(repo, 'show', 'vadd/prot1234:backend/.env.testing')).toContain('DB_HOST=mysql')
  })

  it('says which paths it excluded rather than dropping them silently', async () => {
    const { project, objective } = await seedProtected()
    await runIntegration({ db, bus }, objective, project, 'commit')
    const excluded = bus.since('o1', 0).find((e) => e.type === 'integrate_protected_excluded')
    expect((excluded?.payload as { paths: string[] } | undefined)?.paths.sort()).toEqual([
      'backend/.env.testing',
      'backend/database/migrations/0001_x.php',
      'backend/vendor/autoload.php',
    ])
  })

  it('commits the protected paths when no glob claims them', async () => {
    const { project, objective, baseSha } = await seedProtected({
      verify: { setup: [], commands: [], checks: [], timeoutSec: 600 },
      policy: { protectedGlobs: [], maxFastFixLines: 150 },
    })
    await runIntegration({ db, bus }, objective, project, 'commit')
    const files = git(repo, 'diff', '--name-only', `${baseSha}..vadd/prot1234`).split('\n')
    expect(files.sort()).toEqual([
      'backend/.env.testing',
      'backend/app/Collector.php',
      'backend/database/migrations/0001_x.php',
      'backend/vendor/autoload.php',
    ])
  })

  it('emits integrate_empty when every changed path is protected', async () => {
    const { project, objective, wt } = await seedProtected()
    // Undo the one unprotected change, so nothing but protected paths is left.
    git(wt, 'rm', '-q', 'backend/app/Collector.php')
    git(wt, 'commit', '-qm', 'vadd-checkpoint: task 2')

    const out = await runIntegration({ db, bus }, objective, project, 'commit')
    expect(out).toEqual({ ok: true, committed: false })
    expect(bus.since('o1', 0).map((e) => e.type)).toContain('integrate_empty')
  })
})
