import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { AcpAgentPort } from '../../src/agent/acp-agent-port.js'
import { AgentRegistry } from '../../src/agent/registry.js'
import { createDb, type Db } from '../../src/db/client.js'
import { objectives, projects } from '../../src/db/schema.js'
import { EventBus, type VaddEvent } from '../../src/events/event-bus.js'
import { buildApp } from '../../src/http/app.js'
import { until } from './until.js'

/** Points VADD_HOME at a fresh temp dir for the current test. Returns the path. */
export function withTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'vadd-home-'))
  process.env.VADD_HOME = home
  return home
}

/** Creates a temp git repo with one commit. Returns its path. */
export function makeTempRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'vadd-repo-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'test@vadd.local')
  git('config', 'user.name', 'vadd test')
  writeFileSync(join(repo, 'README.md'), '# temp\n')
  git('add', '-A')
  git('commit', '-qm', 'init')
  return repo
}

/**
 * Inserts a project and one `creating` objective whose `worktreePath` is a real
 * directory, and returns the row.
 *
 * For the verification tests, which need an objective row and a `cwd` but no
 * workflow, no agent and no HTTP app. `makeTempRepo()` supplies the directory:
 * setup and the collector only need somewhere to run, but a real git repo costs
 * nothing and keeps the fixture honest about what a worktree is.
 */
export function makeObjectiveRow(
  db: Db,
  overrides: Partial<typeof objectives.$inferInsert> = {},
): typeof objectives.$inferSelect {
  const now = new Date().toISOString()
  const projectId = randomUUID()
  const worktreePath = makeTempRepo()
  db.insert(projects)
    .values({
      id: projectId,
      name: 'p',
      repoPath: makeTempRepo(),
      config: {},
      createdAt: now,
    })
    .run()
  return db
    .insert(objectives)
    .values({
      id: randomUUID(),
      projectId,
      title: 't',
      goalText: 'g',
      worktreePath,
      branchName: 'vadd/test',
      status: 'creating',
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get()
}

const fakeAcpAgent = fileURLToPath(new URL('./fake-acp-agent.ts', import.meta.url))

// `pnpm tsx <file>` requires a package.json in `cwd` to resolve its project
// context, which fails once `cwd` is a bare objective worktree — the same
// class of failure acp-agent-port.test.ts documents and works around.
// Resolving tsx's own CLI entry and spawning it through node sidesteps pnpm's
// project resolution entirely and is independent of `cwd`.
function resolveTsxCli(): string {
  const pkgPath = fileURLToPath(import.meta.resolve('tsx/package.json'))
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string }
  return resolve(dirname(pkgPath), pkg.bin)
}
const tsxCli = resolveTsxCli()

export type TestApp = {
  app: FastifyInstance
  db: Db
  bus: EventBus
  agents: AgentRegistry
  objectiveId: string
  /** The goal text the test objective was created with. */
  goalText: string
  /** All events recorded for the test objective, oldest first. */
  events: () => VaddEvent[]
  /** Waits for a condition, polling instead of sleeping a guessed interval. */
  until: (cond: () => boolean, timeoutMs?: number) => Promise<void>
  /** Stops any agent left running so the test does not leak a child process. */
  cleanup: () => Promise<void>
}

/**
 * Spins up a full app — temp home, fresh db, event bus, agent registry backed
 * by the fake ACP peer, one project, one objective — for tests that exercise
 * the prompt route end to end. `fakeAcpMode` selects the fake peer's
 * behaviour (see fake-acp-agent.ts); defaults to its 'normal' mode.
 */
export async function buildTestApp(opts: { fakeAcpMode?: string } = {}): Promise<TestApp> {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  // Forwards the registry's onPermission untouched, so the logging path under
  // test is the same one production uses.
  const agents = new AgentRegistry(
    db,
    bus,
    ({ worktreePath, onPermission }) =>
      new AcpAgentPort({
        worktreePath,
        command: process.execPath,
        args: [tsxCli, fakeAcpAgent],
        env: { FAKE_ACP_MODE: opts.fakeAcpMode ?? 'normal' },
        onPermission,
      }),
  )
  const app = buildApp({ db, bus, agents })
  const projectId = (
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { repoPath: makeTempRepo() },
    })
  ).json().id as string
  const goalText = 'g'
  const objective = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText },
    })
  ).json() as { id: string }

  return {
    app,
    db,
    bus,
    agents,
    objectiveId: objective.id,
    goalText,
    events: () => bus.since(objective.id, 0),
    until: (cond, timeoutMs) => until(cond, timeoutMs),
    cleanup: () => agents.stopAll(),
  }
}
