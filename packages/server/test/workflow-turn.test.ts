import { describe, expect, it } from 'vitest'
import type { PortFactory } from '../src/agent/registry.js'
import { AgentRegistry } from '../src/agent/registry.js'
import { createDb, type Db } from '../src/db/client.js'
import { events, objectives, projects, settings } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { renderTurnPrompt, runTurn, TurnRejected, turnTimeoutMs } from '../src/workflow/turn.js'
import { buildTestApp, withTempHome } from './fixtures/temp-repo.js'

function freshDb(): Db {
  const home = withTempHome()
  return createDb(`${home}/vadd.db`)
}

/**
 * Modeled on registry.test.ts's `stubFactory`: a port cheap enough to start
 * instantly, with `prompt()` behaviour selectable per test rather than
 * hard-coded. 'immediate' emits one valid `status` event through the
 * `onUpdate` callback `AgentRegistry` wires at `ensure()` time — the same
 * path a real turn's pipeline ingestion runs through — before resolving.
 * 'hang' never resolves at all: the same shape as the fake ACP peer's
 * `hang-on-prompt` mode (`fixtures/fake-acp-agent.ts`), whose
 * `session/cancel` is a no-op notification that does not answer the pending
 * prompt either. `registry.test.ts`'s own `stubFactory` always resolves
 * `prompt()` immediately and never counts `cancel()` calls, so it cannot
 * cover either "hang" behaviour the timeout test needs; this extends the
 * same shape rather than reusing that one verbatim.
 */
function stubFactory(behavior: 'immediate' | 'hang') {
  let cancelCalls = 0
  let onUpdate: ((u: unknown) => void) | undefined
  const factory: PortFactory = () => {
    const port = {
      async start() {},
      async newSession() {
        return { sessionId: 'session-1' }
      },
      async prompt(sessionId: string) {
        if (behavior === 'hang') return new Promise<{ stopReason: string }>(() => {})
        onUpdate?.({
          sessionId,
          receivedAt: new Date().toISOString(),
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: '```vadd-event\n{"type":"status","phase":"exploring","headline":"Looking around"}\n```\n',
            },
          },
        })
        return { stopReason: 'end_turn' }
      },
      async cancel() {
        cancelCalls += 1
      },
      async stop() {},
      onUpdate: (cb: (u: unknown) => void) => {
        onUpdate = cb
        return () => {
          onUpdate = undefined
        }
      },
      onExit: () => () => {},
    }
    return port as unknown as ReturnType<PortFactory>
  }
  return { factory, cancelCalls: () => cancelCalls }
}

function setup(behavior: 'immediate' | 'hang') {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const { factory, cancelCalls } = stubFactory(behavior)
  const agents = new AgentRegistry(db, bus, factory)

  // agent_sessions.objectiveId and objectives.projectId are real foreign keys
  // with foreign_keys ON, so both rows have to exist first — same reasoning
  // registry.test.ts's setup() documents.
  const now = new Date().toISOString()
  db.insert(projects)
    .values({ id: 'proj-1', name: 'p', repoPath: `${home}/repo`, config: {}, createdAt: now })
    .run()
  db.insert(objectives)
    .values({
      id: 'obj-1',
      projectId: 'proj-1',
      title: 't',
      goalText: 'g',
      worktreePath: `${home}/wt`,
      branchName: 'vadd/obj-1',
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const objective = { id: 'obj-1', title: 't', goalText: 'g', worktreePath: `${home}/wt` }
  return { db, bus, agents, objective, cancelCalls }
}

describe('turnTimeoutMs', () => {
  it('defaults to 20 minutes', () => {
    const db = freshDb()
    expect(turnTimeoutMs(db)).toBe(20 * 60 * 1000)
  })

  it('reads settings.turnTimeoutSec when present', () => {
    const db = freshDb()
    db.insert(settings).values({ key: 'turnTimeoutSec', value: 90 }).run()
    expect(turnTimeoutMs(db)).toBe(90_000)
  })

  it('ignores a non-numeric or non-positive setting rather than disabling the timeout', () => {
    const db = freshDb()
    db.insert(settings).values({ key: 'turnTimeoutSec', value: 'soon' }).run()
    expect(turnTimeoutMs(db)).toBe(20 * 60 * 1000)

    const db2 = freshDb()
    db2.insert(settings).values({ key: 'turnTimeoutSec', value: 0 }).run()
    expect(turnTimeoutMs(db2)).toBe(20 * 60 * 1000)
  })
})

describe('runTurn', () => {
  it('resolves ok when the prompt settles', async () => {
    const { db, bus, agents, objective } = setup('immediate')
    await agents.ensure(objective)

    const out = await runTurn({ db, bus, agents }, objective, { phase: 'explore' })

    expect(out.ok).toBe(true)
  })

  it('cancels the session and reports a timeout when the agent wedges', async () => {
    const { db, bus, agents, objective, cancelCalls } = setup('hang')
    await agents.ensure(objective)

    const out = await runTurn({ db, bus, agents }, objective, { phase: 'explore', timeoutMs: 50 })

    expect(out).toMatchObject({ ok: false, reason: 'timeout' })
    // The turn must be closed, or every later prompt on this objective 409s
    // forever — the failure mode cancel already cost one corpus transcript.
    expect(agents.get(objective.id)?.turnId).toBeNull()
    expect(cancelCalls()).toBe(1)
  })

  it('appends a persisted event for the timeout, not just a log line', async () => {
    const { db, bus, agents, objective } = setup('hang')
    await agents.ensure(objective)

    const out = await runTurn({ db, bus, agents }, objective, { phase: 'explore', timeoutMs: 50 })

    expect(out.ok).toBe(false)
    const types = db
      .select()
      .from(events)
      .all()
      .map((e) => e.type)
    expect(types).toContain('turn_timed_out')
  })
})

describe('renderTurnPrompt', () => {
  const objective = { id: 'obj-1', title: 't', goalText: 'g', worktreePath: null }

  it('takes no live agent registry entry — it is pure over the objective and the turn request', () => {
    // No AgentRegistry, no db, no bus: proves the validation genuinely needs
    // nothing but the objective row and the request, so the route can run it
    // before agents.ensure() without spawning anything first.
    const { text, expect: groups } = renderTurnPrompt(objective, { phase: 'explore' })
    expect(text).toContain('g')
    expect(groups).toEqual([['status', 'clarification']])
  })

  it('rejects an unknown phase with TurnRejected(400)', () => {
    expect(() => renderTurnPrompt(objective, { phase: 'nope' })).toThrow(TurnRejected)
    try {
      renderTurnPrompt(objective, { phase: 'nope' })
    } catch (err) {
      expect(err).toBeInstanceOf(TurnRejected)
      expect((err as TurnRejected).status).toBe(400)
    }
  })
})

describe('the route rejects an invalid phase before touching the agent registry', () => {
  // Regression cover for the reordering finding: a request that renderTurnPrompt
  // will reject must never reach agents.ensure(), or a client retrying against a
  // bad phase would accumulate live agent child processes for an objective that
  // never gets a valid turn. routes-phase-prompt.test.ts already covers the 400
  // itself and must stay unedited (a different task's protected file), so the
  // added assertion — no agent was spawned — lives here instead.
  it('spawns no agent for an unknown phase', async () => {
    const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/objectives/${ctx.objectiveId}/events`,
        payload: { type: 'prompt', phase: 'nope' },
      })
      expect(res.statusCode).toBe(400)
      expect(ctx.agents.get(ctx.objectiveId)).toBeUndefined()
    } finally {
      await ctx.cleanup()
    }
  })

  it('spawns no agent for an unresolved placeholder', async () => {
    const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/objectives/${ctx.objectiveId}/events`,
        payload: { type: 'prompt', phase: 'verify' },
      })
      expect(res.statusCode).toBe(400)
      expect(ctx.agents.get(ctx.objectiveId)).toBeUndefined()
    } finally {
      await ctx.cleanup()
    }
  })
})
