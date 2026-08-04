import { expect, test } from 'vitest'
import { AgentRegistry, type PortFactory } from '../src/agent/registry.js'
import { createDb } from '../src/db/client.js'
import { agentSessions } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { buildTestApp, makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

test('a prompt reaches the agent and its updates become events', async () => {
  const ctx = await buildTestApp()
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'prompt', text: 'do a thing' },
  })
  expect(res.statusCode).toBe(202)

  await ctx.until(() => ctx.events().some((e) => e.type === 'agent_update'))
  const types = ctx.events().map((e) => e.type)
  expect(types).toContain('agent_update')
  await ctx.cleanup()
})

test('an agent_sessions row is recorded on first prompt', async () => {
  const ctx = await buildTestApp()
  await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'prompt', text: 'hi' },
  })
  await ctx.until(() => ctx.db.select().from(agentSessions).all().length === 1)
  const rows = ctx.db.select().from(agentSessions).all()
  expect(rows).toHaveLength(1)
  expect(rows[0]?.acpSessionId).toBe('fake-session-1')
  await ctx.cleanup()
})

test('a second prompt reuses the same session', async () => {
  const ctx = await buildTestApp()
  const finishedCount = () => ctx.events().filter((e) => e.type === 'prompt_finished').length

  for (const [i, text] of ['one', 'two'].entries()) {
    await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: { type: 'prompt', text },
    })
    // Count, not existence: after the first turn a "some(prompt_finished)"
    // check is already true, so the second prompt would not be waited on at all.
    await ctx.until(() => finishedCount() === i + 1)
  }
  expect(ctx.db.select().from(agentSessions).all()).toHaveLength(1)
  await ctx.cleanup()
})

test('a second prompt while a turn is in flight is rejected, not silently dropped', async () => {
  // 'hang-on-prompt' never resolves the first turn, so entry.pipeline stays
  // turnActive indefinitely — the second POST deterministically lands while
  // the guard is up, no sleep-based race needed. Before the guard, the second
  // beginTurn would have reset the pipeline's buffered state out from under
  // the first, still-open turn with no violation recorded.
  const ctx = await buildTestApp({ fakeAcpMode: 'hang-on-prompt' })
  const first = await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'prompt', text: 'first' },
  })
  expect(first.statusCode).toBe(202)
  await ctx.until(() => ctx.events().some((e) => e.type === 'prompt_sent'))

  const second = await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'prompt', text: 'second' },
  })
  expect(second.statusCode).toBe(409)

  const sent = ctx.events().filter((e) => e.type === 'prompt_sent')
  expect(sent).toHaveLength(1)
  await ctx.cleanup()
})

test('cancelling a turn the adapter never settles frees the objective for the next prompt', async () => {
  // 'hang-on-prompt' never answers session/prompt, and the fake peer treats
  // session/cancel as the notification it is — which is exactly the case the
  // bug bit. The cancel branch used to emit an event and touch nothing else,
  // so entry.pipeline stayed turnActive forever and every later prompt on this
  // objective returned 409 permanently. The only recovery was
  // `integrate: discard`, which destroys the worktree: during hand-driven
  // corpus recording, cancelling one slow turn cost the whole transcript.
  const ctx = await buildTestApp({ fakeAcpMode: 'hang-on-prompt' })
  const send = (text: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: { type: 'prompt', text },
    })

  expect((await send('a slow turn')).statusCode).toBe(202)
  await ctx.until(() => ctx.agents.get(ctx.objectiveId) !== undefined)
  await ctx.until(() => ctx.agents.get(ctx.objectiveId)?.pipeline.turnActive === true)

  const cancel = await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'cancel' },
  })
  expect(cancel.statusCode).toBe(200)
  expect(ctx.agents.get(ctx.objectiveId)?.pipeline.turnActive).toBe(false)

  expect((await send('the next turn')).statusCode).toBe(202)
  await ctx.cleanup()
})

test('a cancel request is not itself a terminal record', async () => {
  // Exactly one terminal per turn is what `loadTranscript` needs to replay the
  // same updates the live pipeline saw. The request and the turn ending are two
  // different events, and emitting `prompt_cancelled` for the request put a
  // second terminal in the turn once the prompt settled.
  const ctx = await buildTestApp({ fakeAcpMode: 'hang-on-prompt' })
  await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'prompt', text: 'a slow turn' },
  })
  await ctx.until(() => ctx.agents.get(ctx.objectiveId)?.pipeline.turnActive === true)
  await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'cancel' },
  })

  const types = ctx.events().map((e) => e.type)
  expect(types).toContain('prompt_cancel_requested')
  // The adapter never settled this prompt, so no terminal exists at all — and
  // the objective is still usable, which is the point.
  expect(types).not.toContain('prompt_cancelled')
  expect(types).not.toContain('prompt_finished')
  await ctx.cleanup()
})

test('cancelling with no live agent is still a 409', async () => {
  const ctx = await buildTestApp()
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'cancel' },
  })
  expect(res.statusCode).toBe(409)
  await ctx.cleanup()
})

test('an agent crash marks the session failed and emits an event', async () => {
  const ctx = await buildTestApp({ fakeAcpMode: 'crash-on-prompt' })
  await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'prompt', text: 'crash' },
  })
  await ctx.until(() => ctx.events().some((e) => e.type === 'agent_failed'))

  const types = ctx.events().map((e) => e.type)
  expect(types).toContain('agent_failed')
  const rows = ctx.db.select().from(agentSessions).all()
  expect(rows[0]?.status).toBe('failed')
  await ctx.cleanup()
})

test('permission decisions reach the event log with their reason', async () => {
  // Uses the fake peer's 'permission' mode, which requests permission for a path
  // outside the worktree. Answering the callback is not enough — the milestone
  // requires the rejection to be logged, and `reason` is the only record of why.
  const ctx = await buildTestApp({ fakeAcpMode: 'permission' })
  await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'prompt', text: 'touch something outside' },
  })
  await ctx.until(() => ctx.events().some((e) => e.type === 'permission_decision'))

  const decisions = ctx.events().filter((e) => e.type === 'permission_decision')
  expect(decisions).toHaveLength(1)
  expect(decisions[0]?.payload).toMatchObject({ allowed: false })
  expect((decisions[0]?.payload as { reason?: string } | undefined)?.reason).toMatch(
    /outside the objective worktree/i,
  )
  await ctx.cleanup()
})

test('discarding an objective stops its agent', async () => {
  const ctx = await buildTestApp()
  await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'prompt', text: 'hi' },
  })
  await ctx.until(() => ctx.agents.get(ctx.objectiveId) !== undefined)
  // The agent is genuinely up before the discard, so what follows is a real
  // teardown rather than a no-op against nothing.
  const sessionRow = ctx.db.select().from(agentSessions).all()[0]
  expect(sessionRow?.status).toBe('running')

  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'integrate', action: 'discard' },
  })
  expect(res.statusCode).toBe(200)

  // Assert the POSITIVE. The previous version checked only a 200 and an absence
  // of agent_failed — and a live child emits no exit, so that assertion passed
  // *harder* when the agent was never stopped at all. It could not fail, while
  // being the only automated cover for "killing the server leaves no orphan".
  expect(ctx.agents.get(ctx.objectiveId)).toBeUndefined()

  // An intentional stop must not look like a crash. Without the guard in the
  // onExit handler this emits agent_failed and poisons the flakiness signal.
  const failures = ctx.events().filter((e) => e.type === 'agent_failed')
  expect(failures).toHaveLength(0)
  await ctx.cleanup()
})

test('discarding mid-turn reports a cancelled turn, not a failed one', async () => {
  // The turn never settled at all before AgentStoppedError existed: no
  // prompt_finished, no prompt_failed, nothing. The page showed it running
  // forever.
  const ctx = await buildTestApp({ fakeAcpMode: 'hang-on-prompt' })
  await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'prompt', text: 'a turn that never finishes' },
  })
  await ctx.until(() => ctx.agents.get(ctx.objectiveId) !== undefined)

  await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload: { type: 'integrate', action: 'discard' },
  })
  await ctx.until(() => ctx.events().some((e) => e.type === 'prompt_cancelled'))

  const types = ctx.events().map((e) => e.type)
  expect(types).toContain('prompt_cancelled')
  expect(types).not.toContain('prompt_failed')
  await ctx.cleanup()
})

test('an agent-start failure reports a usable message through the route', async () => {
  // Regression cover for the routes, not just the helper. Reverting the three
  // call sites to `String(err)` leaves the errorMessage unit test green while
  // users see "[object Object]" again — ACP rejects with plain objects, so this
  // is the common path, not the rare one.
  //
  // Not built via buildTestApp: this needs a hand-crafted port that throws a
  // plain JSON-RPC-shaped rejection from start(), not the fake ACP subprocess.
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const agents = new AgentRegistry(db, bus, () => {
    const port = {
      async start() {
        // Exactly the shape the SDK rejects with: a plain JSON-RPC error.
        throw { code: -32603, message: 'boom' }
      },
      async newSession() {
        return { sessionId: 's' }
      },
      async prompt() {
        return { stopReason: 'end_turn' }
      },
      async cancel() {},
      async stop() {},
      onUpdate: () => () => {},
      onExit: () => () => {},
    }
    return port as unknown as ReturnType<PortFactory>
  })
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

  const res = await app.inject({
    method: 'POST',
    url: `/api/objectives/${objective.id}/events`,
    payload: { type: 'prompt', text: 'hi' },
  })

  expect(res.statusCode).toBe(500)
  expect(res.json().error).toContain('boom')
  expect(res.json().error).not.toContain('[object Object]')

  const failed = bus.since(objective.id, 0).find((e) => e.type === 'agent_start_failed')
  expect(failed).toBeDefined()
  const message = (failed?.payload as { message?: string } | undefined)?.message ?? ''
  expect(message).toContain('boom')
  expect(message).not.toContain('[object Object]')
})
