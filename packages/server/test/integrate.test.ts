import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
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
