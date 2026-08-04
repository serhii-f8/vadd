import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  // try/finally: without it, any failure below — the timeout path especially —
  // skips the teardown and leaks a live claude-code-acp process, a worktree and
  // two temp dirs. That is the exact condition criterion 9 exists to prevent,
  // in the one test that spawns a real agent.
  try {
    const promptRes = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objective.id}/events`,
      payload: {
        type: 'prompt',
        text: 'Append the line "hello from vadd" to README.md, then stop.',
      },
    })
    expect(promptRes.statusCode).toBe(202)

    // Poll until the turn finishes rather than sleeping a fixed interval.
    const deadline = Date.now() + 150_000
    let finished = false
    while (Date.now() < deadline && !finished) {
      await new Promise((r) => setTimeout(r, 2000))
      finished = bus.since(objective.id, 0).some((e) => e.type === 'prompt_finished')
    }

    const events = bus.since(objective.id, 0)
    const types = events.map((e) => e.type)
    expect(types).toContain('agent_update')
    expect(types).toContain('prompt_finished')

    // A refusal, a token limit and a cancellation all produce prompt_finished.
    // Only end_turn means the agent actually did the work.
    const finishedEvent = events.find((e) => e.type === 'prompt_finished')
    expect(finishedEvent).toBeDefined()
    expect((finishedEvent?.payload as { stopReason?: string } | undefined)?.stopReason).toBe(
      'end_turn',
    )

    // The criterion is "reaches Claude Code **in that worktree**". Without this
    // the test passes with the agent running in entirely the wrong directory.
    expect(readFileSync(join(objective.worktreePath, 'README.md'), 'utf8')).toContain(
      'hello from vadd',
    )
  } finally {
    await agents.stopAll()
    await app.inject({
      method: 'POST',
      url: `/api/objectives/${objective.id}/events`,
      payload: { type: 'integrate', action: 'discard' },
    })
  }

  expect(await listWorktrees(repo)).toHaveLength(1)
})
