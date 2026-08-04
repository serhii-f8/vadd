import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import { AgentRegistry } from '../src/agent/registry.js'
import { createDb } from '../src/db/client.js'
import { EventBus } from '../src/events/event-bus.js'
import { listWorktrees } from '../src/git/git-manager.js'
import { buildApp } from '../src/http/app.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

const run = process.env.VADD_E2E === '1' ? test : test.skip

run('a real prompt reaches Claude Code in a worktree', { timeout: 180_000 }, async () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const agents = new AgentRegistry(db, bus)
  const app = buildApp({ db, bus, agents })
  const repo = makeTempRepo()

  const projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json().id as string

  const objective = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 'E2E', goalText: 'Append a line to README.md' },
    })
  ).json()

  expect(existsSync(objective.worktreePath)).toBe(true)

  await app.inject({
    method: 'POST',
    url: `/api/objectives/${objective.id}/events`,
    payload: { type: 'prompt', text: 'Append the line "hello from vadd" to README.md, then stop.' },
  })

  // Poll until the turn finishes rather than sleeping a fixed interval.
  const deadline = Date.now() + 150_000
  let finished = false
  while (Date.now() < deadline && !finished) {
    await new Promise((r) => setTimeout(r, 2000))
    finished = bus.since(objective.id, 0).some((e) => e.type === 'prompt_finished')
  }

  const types = bus.since(objective.id, 0).map((e) => e.type)
  expect(types).toContain('agent_update')
  expect(types).toContain('prompt_finished')

  await agents.stopAll()
  await app.inject({
    method: 'POST',
    url: `/api/objectives/${objective.id}/events`,
    payload: { type: 'integrate', action: 'discard' },
  })
  expect(await listWorktrees(repo)).toHaveLength(1)
})
