import { eq } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { describe, expect, it } from 'vitest'
import type { PortFactory } from '../src/agent/registry.js'
import { AgentRegistry } from '../src/agent/registry.js'
import { createDb, type Db } from '../src/db/client.js'
import {
  decisions,
  evidenceItems,
  machineSnapshots,
  objectives,
  planTasks,
} from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { WorkflowRunner } from '../src/workflow/runner.js'
import { loadSnapshot } from '../src/workflow/store.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'
import { until } from './fixtures/until.js'

/**
 * Modeled on workflow-runner.test.ts's `stubFactory`, with one addition: the
 * emitted event depends on the prompt.
 *
 * That matters because a turn whose `expects` goes unmet triggers turn.ts's
 * repair prompt — a *second* `prompt()` call `runTurn` awaits — so a stub that
 * always emitted `status` would leave every `propose` turn hanging on a repair
 * this file never settles. Answering each phase with the event its template
 * actually solicits keeps turns one-settle-each, and routes `decision_needed`
 * through the real pipeline → `ingest` → `recordDecision` path rather than
 * injecting it at the runner.
 */
function stubFactory() {
  let onUpdate: ((u: unknown) => void) | undefined
  const resolvers: Array<(v: { stopReason: string }) => void> = []

  const block = (json: string) => `\`\`\`vadd-event\n${json}\n\`\`\`\n`
  const STATUS = block('{"type":"status","phase":"exploring","headline":"Looking around"}')
  const DECISION = block(
    JSON.stringify({
      type: 'decision_needed',
      question: 'which?',
      options: [
        { id: 'a', label: 'A', pros: [], cons: [], reversibility: 'high', verification: 'v' },
        { id: 'b', label: 'B', pros: [], cons: [], reversibility: 'low', verification: 'v' },
      ],
      recommendedId: 'a',
    }),
  )

  const factory: PortFactory = () =>
    ({
      async start() {},
      async newSession() {
        return { sessionId: 'session-1' }
      },
      async prompt(sessionId: string, text: string) {
        // `propose.md`'s opening line. Matching on the rendered prompt keeps
        // the stub honest about which turn it is answering.
        const isPropose = text.includes('There is a real choice to make here')
        onUpdate?.({
          sessionId,
          receivedAt: new Date().toISOString(),
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: isPropose ? DECISION : STATUS },
          },
        })
        return new Promise<{ stopReason: string }>((resolve) => {
          resolvers.push(resolve)
        })
      },
      async cancel() {},
      async stop() {},
      onUpdate: (cb: (u: unknown) => void) => {
        onUpdate = cb
        return () => {
          onUpdate = undefined
        }
      },
      onExit: () => () => {},
    }) as unknown as ReturnType<PortFactory>

  return {
    factory,
    /** In-flight prompts, so a caller can wait for one instead of racing it. */
    pending: () => resolvers.length,
    /**
     * Settles the oldest in-flight prompt, which is what makes `runTurn`
     * resolve, `endTurn` run, and the machine receive `TURN_FINISHED` through
     * the production path. Sending `TURN_FINISHED` by hand instead would
     * advance the machine while the pipeline's turn was still open, and the
     * next state's entry prompt would be refused with "A turn is already in
     * flight" — a state this code can only reach under an artificial test.
     */
    settleNext: () => {
      const resolve = resolvers.shift()
      if (!resolve) throw new Error('no pending fake prompt to settle')
      resolve({ stopReason: 'end_turn' })
    },
  }
}

function setup() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const { factory, settleNext, pending } = stubFactory()

  let runner!: WorkflowRunner
  const agents = new AgentRegistry(db, bus, factory, (objectiveId, emission) => {
    runner.ingest(objectiveId, emission)
  })
  runner = new WorkflowRunner({ db, bus, agents })

  const app = buildApp({ db, bus, agents, runner })
  return { db, bus, agents, runner, app, settleNext, pending, repo: makeTempRepo() }
}

async function withObjective(payload: Record<string, unknown> = {}) {
  const ctx = setup()
  const projectId = (
    await ctx.app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: ctx.repo } })
  ).json().id as string
  const created = await ctx.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: { title: 't', goalText: 'g', ...payload },
  })
  return { ...ctx, projectId, created, objectiveId: created.json().id as string }
}

// Return type annotated explicitly: fastify's `inject` is overloaded, and
// without the annotation TS infers the chainable form, which carries no
// `statusCode`.
async function command(
  ctx: Awaited<ReturnType<typeof withObjective>>,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return await ctx.app.inject({
    method: 'POST',
    url: `/api/objectives/${ctx.objectiveId}/events`,
    payload,
  })
}

function statusOf(db: Db, id: string): string {
  return db.select().from(objectives).where(eq(objectives.id, id)).get()?.status ?? ''
}

describe('objective creation', () => {
  it('starts an objective at `idle`, the machine initial state, not M0 `ready`', async () => {
    const ctx = await withObjective()
    expect(ctx.created.statusCode).toBe(201)
    expect(statusOf(ctx.db, ctx.objectiveId)).toBe('idle')
  })

  it('defaults mode to standard and stores an explicit fastfix', async () => {
    const std = await withObjective()
    expect(std.created.json().mode).toBe('standard')
    const fast = await withObjective({ mode: 'fastfix' })
    expect(fast.created.json().mode).toBe('fastfix')
  })

  it('stores verificationOverrides on the row', async () => {
    const ctx = await withObjective({
      verificationOverrides: {
        verify: { commands: [{ id: 'test', run: 'pnpm test', required: true }] },
      },
    })
    const row = ctx.db.select().from(objectives).where(eq(objectives.id, ctx.objectiveId)).get()
    const spec = row?.verificationSpec as
      | { verify: { commands: { cwd: string }[] } }
      | null
      | undefined
    expect(spec?.verify.commands).toHaveLength(1)
    // Parsed, not stored verbatim: the schema's defaults have been applied.
    expect(spec?.verify.commands[0]?.cwd).toBe('.')
  })

  it('rejects a malformed verificationOverrides rather than storing it', async () => {
    const ctx = setup()
    const projectId = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { repoPath: ctx.repo },
      })
    ).json().id as string
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g', verificationOverrides: { verify: { commands: 'no' } } },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('commands the machine accepts', () => {
  it('start moves idle → exploring', async () => {
    const ctx = await withObjective()
    const res = await command(ctx, { type: 'start' })
    expect(res.statusCode).toBe(202)
    expect(statusOf(ctx.db, ctx.objectiveId)).toBe('exploring')
  })

  it('pause remembers where it came from, and resume returns there', async () => {
    const ctx = await withObjective()
    await command(ctx, { type: 'start' })
    expect((await command(ctx, { type: 'pause' })).statusCode).toBe(202)
    expect(statusOf(ctx.db, ctx.objectiveId)).toBe('paused')
    expect((await command(ctx, { type: 'resume' })).statusCode).toBe(202)
    expect(statusOf(ctx.db, ctx.objectiveId)).toBe('exploring')
  })

  it('decide records the choice and advances to planning', async () => {
    const ctx = await withObjective()
    await driveToAwaitingDecision(ctx)

    const decisionId = ctx.db.select().from(decisions).all()[0]?.id as string
    const res = await command(ctx, { type: 'decide', decisionId, optionId: 'a' })
    expect(res.statusCode).toBe(202)
    expect(statusOf(ctx.db, ctx.objectiveId)).toBe('planning')
    expect(ctx.db.select().from(decisions).all()[0]?.chosenId).toBe('a')
    expect(ctx.db.select().from(decisions).all()[0]?.decidedBy).toBe('user')
  })
})

/**
 * `start` → settle the explore turn → `proposing` (whose turn the stub answers
 * with a `decision_needed`) → settle → `awaitingDecision`.
 *
 * Each settle is awaited through `until` rather than a fixed delay: `runTurn`
 * resolves across several microtask hops (settle → endTurn → TURN_FINISHED →
 * transition → the next entry's prompt), and a guessed sleep that loses the
 * race hangs to timeout instead of failing.
 */
async function driveToAwaitingDecision(ctx: Awaited<ReturnType<typeof withObjective>>) {
  await command(ctx, { type: 'start' })
  // Each state's entry `sendPrompt` is async (it awaits `agents.ensure` before
  // `runTurn`), so the prompt lands a tick *after* the transition. Waiting on
  // the transition alone would settle a prompt that had not been issued yet.
  await until(() => ctx.pending() === 1)

  ctx.settleNext()
  await until(() => statusOf(ctx.db, ctx.objectiveId) === 'proposing' && ctx.pending() === 1)

  ctx.settleNext()
  await until(() => statusOf(ctx.db, ctx.objectiveId) === 'awaitingDecision')
}

describe('commands the machine refuses', () => {
  it('answers 409 and names the current state rather than silently ignoring', async () => {
    const ctx = await withObjective()
    const res = await command(ctx, { type: 'approve_plan' })
    expect(res.statusCode).toBe(409)
    // "Never drop silently": a command the machine ignored must not be
    // reported as success, and the message has to say what state refused it.
    expect(res.json().error).toContain('idle')
    expect(statusOf(ctx.db, ctx.objectiveId)).toBe('idle')
  })

  it('rejects a decisionId that belongs to no decision on this objective', async () => {
    const ctx = await withObjective()
    await command(ctx, { type: 'start' })
    const res = await command(ctx, { type: 'decide', decisionId: 'nope', optionId: 'a' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/decision/i)
  })

  it('rejects an optionId the decision never offered', async () => {
    const ctx = await withObjective()
    await command(ctx, { type: 'start' })
    ctx.runner.send(ctx.objectiveId, {
      type: 'DECISION_NEEDED',
      event: {
        type: 'decision_needed',
        question: 'which?',
        options: [
          { id: 'a', label: 'A', pros: [], cons: [], reversibility: 'high', verification: 'v' },
          { id: 'b', label: 'B', pros: [], cons: [], reversibility: 'low', verification: 'v' },
        ],
        recommendedId: 'a',
      },
    })
    ctx.runner.send(ctx.objectiveId, { type: 'TURN_FINISHED' })
    const decisionId = ctx.db.select().from(decisions).all()[0]?.id as string
    const res = await command(ctx, { type: 'decide', decisionId, optionId: 'z' })
    expect(res.statusCode).toBe(400)
  })

  it('refuses integrate via pr or merge, saying why', async () => {
    const ctx = await withObjective()
    for (const action of ['pr', 'merge']) {
      const res = await command(ctx, { type: 'integrate', action })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toMatch(/M2/)
    }
  })

  it('answers 409 for a machine command on an objective with no live actor', async () => {
    const ctx = await withObjective()
    ctx.runner.stop(ctx.objectiveId)
    const res = await command(ctx, { type: 'approve_task' })
    expect(res.statusCode).toBe(409)
  })
})

describe('integrate: discard keeps its M0 meaning', () => {
  it('removes the worktree and the row without consulting the machine', async () => {
    const ctx = await withObjective()
    const res = await command(ctx, { type: 'integrate', action: 'discard' })
    expect(res.statusCode).toBe(200)
    expect(ctx.db.select().from(objectives).all()).toHaveLength(0)
  })

  it('discards an objective that has machine rows attached', async () => {
    // Phase 3's four tables all reference objectives.id with no cascade, so a
    // discard that deletes only agent_sessions now trips a FOREIGN KEY
    // violation the moment an objective has ever been driven. Found against
    // the real server: the worktree was removed and the rows survived, leaving
    // an objective pointing at a directory that no longer exists.
    const ctx = await withObjective()
    await driveToAwaitingDecision(ctx)
    expect(ctx.db.select().from(decisions).all().length).toBeGreaterThan(0)
    expect(loadSnapshot(ctx.db, ctx.objectiveId)).not.toBeNull()

    const res = await command(ctx, { type: 'integrate', action: 'discard' })
    expect(res.statusCode).toBe(200)
    expect(ctx.db.select().from(objectives).all()).toHaveLength(0)
    expect(ctx.db.select().from(decisions).all()).toHaveLength(0)
    expect(ctx.db.select().from(machineSnapshots).all()).toHaveLength(0)
    expect(ctx.db.select().from(planTasks).all()).toHaveLength(0)
    expect(ctx.db.select().from(evidenceItems).all()).toHaveLength(0)
  })
})

describe('GET /api/objectives/:id', () => {
  it('returns the aggregate: objective, state, tasks, decisions, evidence', async () => {
    const ctx = await withObjective()
    await command(ctx, { type: 'start' })
    ctx.db
      .insert(planTasks)
      .values({
        id: 'task-1',
        objectiveId: ctx.objectiveId,
        ord: 0,
        title: 'Write a failing test',
        description: 'repro',
        status: 'pending',
        checkpointRef: null,
        startedAt: null,
        finishedAt: null,
      })
      .run()

    const res = await ctx.app.inject({ method: 'GET', url: `/api/objectives/${ctx.objectiveId}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.objective.id).toBe(ctx.objectiveId)
    expect(body.state).toBe('exploring')
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].title).toBe('Write a failing test')
    expect(body.decisions).toEqual([])
    expect(body.evidence).toEqual([])
  })

  it('still 404s for an unknown objective', async () => {
    const ctx = await withObjective()
    const res = await ctx.app.inject({ method: 'GET', url: '/api/objectives/nope' })
    expect(res.statusCode).toBe(404)
  })
})
