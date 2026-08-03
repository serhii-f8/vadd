import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { AcpAgentPort } from '../src/agent/acp-agent-port.js'
import { AgentRegistry } from '../src/agent/registry.js'
import { createDb } from '../src/db/client.js'
import { agentSessions } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

const fake = fileURLToPath(new URL('./fixtures/fake-acp-agent.ts', import.meta.url))

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

async function withObjective(mode = 'normal') {
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
        args: [tsxCli, fake],
        env: { FAKE_ACP_MODE: mode },
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
  const objective = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
  ).json()
  return { app, db, bus, agents, objective }
}

test('a prompt reaches the agent and its updates become events', async () => {
  const { app, bus, agents, objective } = await withObjective()
  const res = await app.inject({
    method: 'POST',
    url: `/api/objectives/${objective.id}/events`,
    payload: { type: 'prompt', text: 'do a thing' },
  })
  expect(res.statusCode).toBe(202)

  await new Promise((r) => setTimeout(r, 500))
  const types = bus.since(objective.id, 0).map((e) => e.type)
  expect(types).toContain('agent_update')
  await agents.stopAll()
})

test('an agent_sessions row is recorded on first prompt', async () => {
  const { app, db, agents, objective } = await withObjective()
  await app.inject({
    method: 'POST',
    url: `/api/objectives/${objective.id}/events`,
    payload: { type: 'prompt', text: 'hi' },
  })
  await new Promise((r) => setTimeout(r, 500))
  const rows = db.select().from(agentSessions).all()
  expect(rows).toHaveLength(1)
  expect(rows[0]?.acpSessionId).toBe('fake-session-1')
  await agents.stopAll()
})

test('a second prompt reuses the same session', async () => {
  const { app, db, agents, objective } = await withObjective()
  for (const text of ['one', 'two']) {
    await app.inject({
      method: 'POST',
      url: `/api/objectives/${objective.id}/events`,
      payload: { type: 'prompt', text },
    })
    await new Promise((r) => setTimeout(r, 400))
  }
  expect(db.select().from(agentSessions).all()).toHaveLength(1)
  await agents.stopAll()
})

test('an agent crash marks the session failed and emits an event', async () => {
  const { app, db, bus, agents, objective } = await withObjective('crash-on-prompt')
  await app.inject({
    method: 'POST',
    url: `/api/objectives/${objective.id}/events`,
    payload: { type: 'prompt', text: 'crash' },
  })
  await new Promise((r) => setTimeout(r, 700))

  const types = bus.since(objective.id, 0).map((e) => e.type)
  expect(types).toContain('agent_failed')
  const rows = db.select().from(agentSessions).all()
  expect(rows[0]?.status).toBe('failed')
  await agents.stopAll()
})

test('permission decisions reach the event log with their reason', async () => {
  // Uses the fake peer's 'permission' mode, which requests permission for a path
  // outside the worktree. Answering the callback is not enough — the milestone
  // requires the rejection to be logged, and `reason` is the only record of why.
  const { app, bus, agents, objective } = await withObjective('permission')
  await app.inject({
    method: 'POST',
    url: `/api/objectives/${objective.id}/events`,
    payload: { type: 'prompt', text: 'touch something outside' },
  })
  await new Promise((r) => setTimeout(r, 600))

  const decisions = bus.since(objective.id, 0).filter((e) => e.type === 'permission_decision')
  expect(decisions).toHaveLength(1)
  expect(decisions[0]?.payload).toMatchObject({ allowed: false })
  expect((decisions[0]?.payload as { reason?: string } | undefined)?.reason).toMatch(
    /outside the objective worktree/i,
  )
  await agents.stopAll()
})

test('discarding an objective stops its agent', async () => {
  const { app, agents, objective } = await withObjective()
  await app.inject({
    method: 'POST',
    url: `/api/objectives/${objective.id}/events`,
    payload: { type: 'prompt', text: 'hi' },
  })
  await new Promise((r) => setTimeout(r, 400))
  const res = await app.inject({
    method: 'POST',
    url: `/api/objectives/${objective.id}/events`,
    payload: { type: 'integrate', action: 'discard' },
  })
  expect(res.statusCode).toBe(200)
  await agents.stopAll()
})
