import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { AgentEvent } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { describe, expect, it } from 'vitest'
import type { PortFactory } from '../src/agent/registry.js'
import { AgentRegistry } from '../src/agent/registry.js'
import { createDb, type Db } from '../src/db/client.js'
import {
  decisions,
  events,
  evidenceItems,
  machineSnapshots,
  objectives,
  planTasks,
} from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { WorkflowRunner } from '../src/workflow/runner.js'
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

  it('set_low_energy updates the row and the live actor immediately', async () => {
    const ctx = await withObjective()
    await command(ctx, { type: 'start' })
    const res = await command(ctx, { type: 'set_low_energy', value: true })
    expect(res.statusCode).toBe(202)

    const row = ctx.db.select().from(objectives).where(eq(objectives.id, ctx.objectiveId)).get()
    expect(row?.lowEnergy).toBe(true)
    expect(ctx.runner.get(ctx.objectiveId)?.getSnapshot().context.lowEnergy).toBe(true)
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

/** An idle objective with a real worktree on disk, and nothing else driven. */
async function seedIdleObjective() {
  const ctx = await withObjective()
  const row = ctx.db.select().from(objectives).where(eq(objectives.id, ctx.objectiveId)).get()
  if (!row?.worktreePath) throw new Error('expected a worktree path')
  return { ...ctx, worktreePath: row.worktreePath }
}

const GREEN_STATUS_EVENT: AgentEvent = {
  type: 'status',
  phase: 'exploring',
  headline: 'Looking around',
}
const GREEN_DECISION_EVENT: AgentEvent = {
  type: 'decision_needed',
  question: 'Which approach?',
  options: [
    { id: 'a', label: 'A', pros: [], cons: [], reversibility: 'high', verification: 'tests pass' },
    { id: 'b', label: 'B', pros: [], cons: [], reversibility: 'high', verification: 'tests pass' },
  ],
  recommendedId: 'a',
}
const GREEN_PLAN_EVENT: AgentEvent = {
  type: 'plan',
  tasks: [{ title: 'Fix it', description: 'Make the failing test pass' }],
}
const GREEN_EXECUTE_TASK_OK: AgentEvent[] = [
  { type: 'evidence', kind: 'test', status: 'pass', headline: 'ok', summary: [] },
  { type: 'task_result', taskId: '0', claim: 'done', evidenceRefs: ['ok'] },
]

/**
 * Modelled on workflow-verification.test.ts's `stubFactory`: batches are
 * consumed in `prompt()` call order rather than matched on prompt text, which
 * is what lets one stub answer explore, propose, plan and execute-task turns
 * in sequence.
 */
function queueStubFactory() {
  let promptCount = 0
  let onUpdate: ((u: unknown) => void) | undefined
  const resolvers: Array<(v: { stopReason: string }) => void> = []
  const eventQueue: AgentEvent[][] = []

  const factory: PortFactory = () => {
    const port = {
      async start() {},
      async newSession() {
        return { sessionId: 'session-1' }
      },
      async prompt(sessionId: string) {
        promptCount += 1
        const batch = eventQueue.shift() ?? []
        for (const e of batch) {
          onUpdate?.({
            sessionId,
            receivedAt: new Date().toISOString(),
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: `\`\`\`vadd-event\n${JSON.stringify(e)}\n\`\`\`\n` },
            },
          })
        }
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
    }
    return port as unknown as ReturnType<PortFactory>
  }

  return {
    factory,
    promptCalls: () => promptCount,
    queueEvents: (...batches: AgentEvent[][]) => eventQueue.push(...batches),
    settleNext: () => {
      const resolve = resolvers.shift()
      if (!resolve) throw new Error('no pending fake prompt to settle')
      resolve({ stopReason: 'end_turn' })
    },
  }
}

/**
 * Satisfies `verify.md`'s `expects` *and* the guard: naming a declared check id
 * is what makes `recordEvidence` set `commandId` (amendment A6).
 */
const GREEN_CHECK_CLAIM: AgentEvent[] = [
  {
    type: 'evidence',
    kind: 'check',
    status: 'pass',
    headline: 'Redirect reproduced and fixed',
    summary: [],
    checkId: 'check-0',
  },
]

/**
 * Drives a fresh objective to `awaitingReview` with a full green evidence set,
 * through the real turn/collector/machine pipeline — the same path
 * `workflow-verification.test.ts` uses, just wired to this file's real HTTP app
 * so the route under test sees the same live actor and the same `baseSha` a
 * real worktree creation stamps.
 *
 * With `checks`, `verifying` takes a verify turn as well, and the batch that
 * answers it is queued up front: the collector is a real subprocess, so the
 * verify prompt lands at an unpredictable moment and a later push could miss it.
 */
async function seedAwaitingReviewWithGreenEvidence(checks: string[] = []) {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const repo = makeTempRepo()
  const { factory, promptCalls, queueEvents, settleNext } = queueStubFactory()

  let runner!: WorkflowRunner
  const agents = new AgentRegistry(db, bus, factory, (objectiveId, emission) => {
    runner.ingest(objectiveId, emission)
  })
  runner = new WorkflowRunner({ db, bus, agents })
  const app = buildApp({ db, bus, agents, runner })

  const projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json().id as string
  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: {
      title: 't',
      goalText: 'g',
      // A command that always passes, so the collector's real subprocess run
      // produces a green `evidence_items` row with `commandId: 'test'`.
      verificationOverrides: {
        verify: { commands: [{ id: 'test', run: 'exit 0', required: true }], checks },
      },
    },
  })
  const objectiveId = created.json().id as string
  const row0 = db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()
  if (!row0?.worktreePath) throw new Error('expected a worktree path')
  const worktreePath = row0.worktreePath

  await agents.ensure({ id: objectiveId, worktreePath, projectId })

  async function settleFakeTurn(): Promise<void> {
    settleNext()
    for (let i = 0; i < 25; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  }

  const stateOf = () => String(runner.get(objectiveId)?.getSnapshot().value)

  runner.start(objectiveId)
  queueEvents(
    [GREEN_STATUS_EVENT],
    [GREEN_DECISION_EVENT],
    [GREEN_PLAN_EVENT],
    GREEN_EXECUTE_TASK_OK,
  )
  if (checks.length > 0) queueEvents(GREEN_CHECK_CLAIM)
  runner.send(objectiveId, { type: 'START' })
  await settleFakeTurn() // explore -> proposing
  await settleFakeTurn() // propose -> awaitingDecision

  const decision = db.select().from(decisions).all()[0]
  if (!decision) throw new Error('expected a decisions row before DECIDE')
  runner.send(objectiveId, { type: 'DECIDE', decisionId: decision.id, optionId: 'a' })
  await settleFakeTurn() // plan -> awaitingPlanApproval

  runner.send(objectiveId, { type: 'APPROVE_PLAN' })
  // `checkpoint` is async and `sendPrompt` awaits it, so `executing` is
  // reached before the execute-task turn exists to be settled.
  await until(() => promptCalls() >= 4)
  await settleFakeTurn() // execute-task -> verifying, which invokes the collector

  if (checks.length > 0) {
    // The verify turn only exists when the spec has checks, and it lands after
    // the collector's real subprocess finishes.
    await until(() => promptCalls() >= 5, 10_000)
    await settleFakeTurn()
  }

  // The collector runs a real subprocess, so the run to `awaitingReview`
  // finishes on its own time rather than on a settled prompt.
  await until(() => stateOf() === 'awaitingReview', 10_000)

  return { app, db, bus, agents, runner, repo, objectiveId, worktreePath, stateOf }
}

/** As above, one `APPROVE_TASK` further on: the state the `integrate` route needs. */
async function seedIntegratingObjectiveWithGreenEvidence() {
  const seeded = await seedAwaitingReviewWithGreenEvidence()
  seeded.runner.send(seeded.objectiveId, { type: 'APPROVE_TASK' })
  await until(() => seeded.stateOf() === 'integrating')
  return seeded
}

/**
 * Drives a fresh objective to `executing` with its execute-task turn
 * genuinely in flight — unsettled, matching the "non-terminal, mid-turn"
 * scenario amendment A9's `abandon` exists for. Same pipeline as
 * `seedIntegratingObjectiveWithGreenEvidence` up to the point `executing`
 * sends its prompt, but stops there rather than settling it.
 */
async function seedExecutingObjective() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const repo = makeTempRepo()
  const { factory, promptCalls, queueEvents, settleNext } = queueStubFactory()

  let runner!: WorkflowRunner
  const agents = new AgentRegistry(db, bus, factory, (objectiveId, emission) => {
    runner.ingest(objectiveId, emission)
  })
  runner = new WorkflowRunner({ db, bus, agents })
  const app = buildApp({ db, bus, agents, runner })

  const projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json().id as string
  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: { title: 't', goalText: 'g' },
  })
  const objectiveId = created.json().id as string
  const row0 = db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()
  if (!row0?.worktreePath) throw new Error('expected a worktree path')
  const worktreePath = row0.worktreePath

  await agents.ensure({ id: objectiveId, worktreePath, projectId })

  async function settleFakeTurn(): Promise<void> {
    settleNext()
    for (let i = 0; i < 25; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  }

  runner.start(objectiveId)
  // The fourth batch answers the execute-task turn that is deliberately left in
  // flight. It exists so there is a real `evidence_items` row to survive the
  // abandon — A9 keeps the evidence precisely when the code is thrown away.
  queueEvents(
    [GREEN_STATUS_EVENT],
    [GREEN_DECISION_EVENT],
    [GREEN_PLAN_EVENT],
    [{ type: 'evidence', kind: 'test', status: 'fail', headline: 'Still red', summary: [] }],
  )
  runner.send(objectiveId, { type: 'START' })
  await settleFakeTurn() // explore -> proposing
  await settleFakeTurn() // propose -> awaitingDecision

  const decision = db.select().from(decisions).all()[0]
  if (!decision) throw new Error('expected a decisions row before DECIDE')
  runner.send(objectiveId, { type: 'DECIDE', decisionId: decision.id, optionId: 'a' })
  await settleFakeTurn() // plan -> awaitingPlanApproval

  runner.send(objectiveId, { type: 'APPROVE_PLAN' })
  // `checkpoint` is async and `sendPrompt` awaits it, so `executing`'s
  // execute-task prompt lands a tick after the transition — the same race
  // `seedAwaitingReviewWithGreenEvidence` waits out. Deliberately not settled:
  // the turn stays in flight, which is the scenario under test.
  await until(() => promptCalls() >= 4)
  // The evidence event travels the whole pipeline before it is a row.
  await until(
    () =>
      db.select().from(evidenceItems).where(eq(evidenceItems.objectiveId, objectiveId)).all()
        .length > 0,
  )

  return { app, db, bus, agents, runner, objectiveId, worktreePath }
}

describe('integrate performs real git work', () => {
  it('refuses from a state the machine will not accept, doing no git work', async () => {
    const { app, objectiveId, worktreePath } = await seedIdleObjective()
    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'integrate', action: 'commit' },
    })
    expect(res.statusCode).toBe(409)
    expect(existsSync(worktreePath)).toBe(true)
  })

  it('stamps integrateAction when the machine reaches done', async () => {
    const { app, db, objectiveId } = await seedIntegratingObjectiveWithGreenEvidence()
    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'integrate', action: 'keep' },
    })
    expect(res.statusCode).toBe(202)
    await until(
      () =>
        db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()?.status === 'done',
    )
    const row = db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()
    expect(row?.integrateAction).toBe('keep')
  })

  /**
   * The route and the machine both evaluate `evidenceComplete`, but from
   * different sources: the route reads the `evidence_items` table, the machine
   * reads `context.evidence` — the snapshot `verifying` took. They agree today
   * only by an argument about reachability, which is a fragile thing to rest a
   * destructive operation on.
   *
   * Sending `EVIDENCE_RESULT` with the same items the route just judged makes
   * them agree by construction instead. `integrating` has that handler for
   * exactly this reason — its own comment says "the set can go red between
   * review and integration".
   */
  it('refreshes the machine context from the table before integrating', async () => {
    const { app, db, runner, objectiveId } = await seedIntegratingObjectiveWithGreenEvidence()

    const before = runner.get(objectiveId)?.getSnapshot().context.evidence ?? []
    // A row the `verifying` snapshot cannot know about: written straight to the
    // table after the context was captured, which is what a manual tick does.
    db.insert(evidenceItems)
      .values({
        id: randomUUID(),
        objectiveId,
        taskId: null,
        commandId: 'check-0',
        kind: 'check',
        status: 'pass',
        headline: 'Confirmed by the user',
        summary: [],
        artifactPath: null,
        decidedBy: 'user',
        createdAt: new Date().toISOString(),
      })
      .run()

    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'integrate', action: 'keep' },
    })
    expect(res.statusCode).toBe(202)

    // Read the persisted snapshot, not the live actor: reaching `done` is
    // terminal, and the runner drops the actor on a terminal state.
    const persisted = db
      .select()
      .from(machineSnapshots)
      .where(eq(machineSnapshots.objectiveId, objectiveId))
      .get()
    const after = (
      persisted?.snapshot as { context?: { evidence?: { commandId: string | null }[] } }
    )?.context?.evidence

    // The context grew to match the table rather than staying at the snapshot
    // `verifying` took.
    expect(after?.length ?? 0).toBeGreaterThan(before.length)
    expect(after?.some((e) => e.commandId === 'check-0')).toBe(true)
  })

  /**
   * `can({type:'INTEGRATE'})` is unconditionally true from `integrating` —
   * the transition is an array whose last branch is unguarded — so it says
   * nothing about the evidence. The route has to evaluate `evidenceComplete`
   * itself, *before* the git work: `commit` squashes and removes the worktree,
   * and reporting that as success on an unproven objective is the exact lie
   * spec §5 exists to prevent.
   */
  it('refuses an incomplete evidence set without touching the worktree or branch', async () => {
    const { app, db, repo, objectiveId, worktreePath } =
      await seedIntegratingObjectiveWithGreenEvidence()
    const branch = db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()
      ?.branchName as string

    // The set going red between review and integration: exactly what
    // `integrating`'s own EVIDENCE_RESULT handler exists for.
    db.update(evidenceItems)
      .set({ status: 'fail' })
      .where(eq(evidenceItems.commandId, 'test'))
      .run()

    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'integrate', action: 'commit' },
    })
    expect(res.statusCode).toBe(409)
    // The status code alone would pass against the broken version too: what
    // makes this test worth anything is that no destructive work happened.
    expect(existsSync(worktreePath)).toBe(true)
    expect(execFileSync('git', ['-C', repo, 'branch', '--list', branch]).toString()).toContain(
      branch,
    )
    expect(db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()?.status).toBe(
      'integrating',
    )
  })

  /**
   * The manual untick sends no `EVIDENCE_RESULT`, so the machine's
   * `context.evidence` still holds the green snapshot taken in `verifying`.
   * Reading the evidence from the database at integration time is what makes
   * the user's own "this is not met" reach the guard — "done means proven, not
   * claimed" applied to the one control the user drives by hand.
   */
  it('refuses to integrate a check the user has unticked', async () => {
    const seeded = await seedAwaitingReviewWithGreenEvidence(['The redirect works'])
    const { app, db, objectiveId, worktreePath } = seeded

    const untick = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'tick_check', checkId: 'check-0', satisfied: false },
    })
    expect(untick.statusCode).toBe(202)

    const approve = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'approve_task' },
    })
    expect(approve.statusCode).toBe(202)
    await until(() => seeded.stateOf() === 'integrating')

    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'integrate', action: 'commit' },
    })
    expect(res.statusCode).toBe(409)
    expect(existsSync(worktreePath)).toBe(true)
    expect(db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()?.status).toBe(
      'integrating',
    )
  })

  it('leaves the objective in integrating when the git work fails', async () => {
    const { app, db, objectiveId } = await seedIntegratingObjectiveWithGreenEvidence()
    // A baseSha that does not resolve is the cheapest real git failure.
    db.update(objectives).set({ baseSha: 'notasha' }).where(eq(objectives.id, objectiveId)).run()
    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'integrate', action: 'commit' },
    })
    expect(res.statusCode).toBe(500)
    expect(db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()?.status).toBe(
      'integrating',
    )
  })
})

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

// The destructive delete moved to `DELETE /api/objectives/:id` (amendment
// A9) — `integrate: discard` is now a machine transition from `integrating`
// like `commit`/`keep`, and its row-deletion assertions moved with it into
// `routes-objectives.test.ts`'s `DELETE /api/objectives/:id` describe.

describe('abandon (amendment A9)', () => {
  it('drives a non-terminal objective to cancelled and keeps every row', async () => {
    const { app, db, objectiveId, worktreePath } = await seedExecutingObjective()
    const res = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'abandon' },
    })
    expect(res.statusCode).toBe(202)
    await until(
      () =>
        db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()?.status ===
        'cancelled',
    )
    const row = db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()
    expect(row).toBeDefined()
    expect(row?.worktreePath).toBeNull()
    expect(existsSync(worktreePath)).toBe(false)

    // Survival across all five tables is A9's whole distinction from DELETE,
    // whose mirror test asserts these four are empty. `seedExecutingObjective`
    // drives the real machine through a decision and a plan, so they exist.
    const where = eq(decisions.objectiveId, objectiveId)
    expect(db.select().from(decisions).where(where).all().length).toBeGreaterThan(0)
    expect(
      db.select().from(planTasks).where(eq(planTasks.objectiveId, objectiveId)).all().length,
    ).toBeGreaterThan(0)
    expect(
      db.select().from(evidenceItems).where(eq(evidenceItems.objectiveId, objectiveId)).all()
        .length,
    ).toBeGreaterThan(0)
    expect(
      db.select().from(machineSnapshots).where(eq(machineSnapshots.objectiveId, objectiveId)).all()
        .length,
    ).toBeGreaterThan(0)
  })

  it('409s on an objective that is already terminal', async () => {
    const { app, db, objectiveId } = await seedExecutingObjective()
    await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'abandon' },
    })
    await until(
      () =>
        db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()?.status ===
        'cancelled',
    )
    const again = await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'abandon' },
    })
    expect(again.statusCode).toBe(409)
  })

  it('does not cancel the in-flight turn meaning of "cancel"', async () => {
    // A9 keeps `cancel` as M0's turn-cancel. Sending it must not make the
    // objective terminal — the corpus-recording path depends on this.
    const { app, db, objectiveId } = await seedExecutingObjective()
    await app.inject({
      method: 'POST',
      url: `/api/objectives/${objectiveId}/events`,
      payload: { type: 'cancel' },
    })
    expect(
      db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()?.status,
    ).not.toBe('cancelled')
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

  // A clarification writes no `decisions` row — the question exists only in the
  // machine's context, so without this field `clarifying` has nothing to show.
  it('exposes the open clarification question from the live actor', async () => {
    const ctx = await withObjective()
    await command(ctx, { type: 'start' })
    ctx.runner.send(ctx.objectiveId, {
      type: 'CLARIFICATION',
      event: {
        type: 'clarification',
        question: 'Which environment does the redirect break in?',
        suggestedAnswers: ['staging', 'production'],
      },
    })
    ctx.runner.send(ctx.objectiveId, { type: 'TURN_FINISHED' })

    const body = (
      await ctx.app.inject({ method: 'GET', url: `/api/objectives/${ctx.objectiveId}` })
    ).json()
    expect(body.state).toBe('clarifying')
    expect(body.pendingClarification).toBe('Which environment does the redirect break in?')
  })

  it('lastAutoApproval is null with no auto-approval event, and reflects the most recent one', async () => {
    const ctx = await withObjective()
    const before = (
      await ctx.app.inject({ method: 'GET', url: `/api/objectives/${ctx.objectiveId}` })
    ).json()
    expect(before.lastAutoApproval).toBeNull()

    ctx.bus.emit({
      objectiveId: ctx.objectiveId,
      type: 'task_auto_approved',
      payload: { taskId: 't1', ord: 2 },
    })

    const after = (
      await ctx.app.inject({ method: 'GET', url: `/api/objectives/${ctx.objectiveId}` })
    ).json()
    expect(after.lastAutoApproval).toMatchObject({ kind: 'task', taskOrd: 2 })
    expect(typeof after.lastAutoApproval.at).toBe('string')
  })

  it('still 404s for an unknown objective', async () => {
    const ctx = await withObjective()
    const res = await ctx.app.inject({ method: 'GET', url: '/api/objectives/nope' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/objectives/:id/continuation-seed', () => {
  it('returns the last task_result claim among later events', async () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    const app = buildApp({ db, bus })
    const projectId = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { repoPath: makeTempRepo() },
      })
    ).json().id as string
    const objectiveId = (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/objectives`,
        payload: { title: 'Fix rounding', goalText: 'Totals are a cent off' },
      })
    ).json().id as string

    // Two task_result events, an older one and a newer one, with a status
    // event in between — proves the route picks the MOST RECENT task_result
    // (by insertion/event id order) rather than merely "any task_result".
    // An implementation that found the first match regardless of order would
    // return the older claim and fail this test.
    const now = new Date().toISOString()
    db.insert(events)
      .values([
        {
          objectiveId,
          type: 'agent_event',
          payload: {
            event: { type: 'task_result', taskId: 't1', claim: "Attempted a fix, didn't work" },
          },
          createdAt: now,
        },
        {
          objectiveId,
          type: 'agent_event',
          payload: { event: { type: 'status', headline: 'trying again' } },
          createdAt: now,
        },
        {
          objectiveId,
          type: 'agent_event',
          payload: {
            event: { type: 'task_result', taskId: 't1', claim: 'Fixed the rounding bug' },
          },
          createdAt: now,
        },
        {
          objectiveId,
          type: 'agent_event',
          payload: { event: { type: 'status', headline: 'wrapping up' } },
          createdAt: now,
        },
      ])
      .run()

    const res = await app.inject({
      method: 'GET',
      url: `/api/objectives/${objectiveId}/continuation-seed`,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.title).toBe('Fix rounding')
    expect(body.goalText).toBe('Totals are a cent off')
    expect(body.lastClaim).toBe('Fixed the rounding bug')
    expect(body.projectId).toBe(projectId)
  })

  it('returns lastClaim: null when no task_result event exists', async () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    const app = buildApp({ db, bus })
    const projectId = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { repoPath: makeTempRepo() },
      })
    ).json().id as string
    const objectiveId = (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/objectives`,
        payload: { title: 't', goalText: 'g' },
      })
    ).json().id as string

    const res = await app.inject({
      method: 'GET',
      url: `/api/objectives/${objectiveId}/continuation-seed`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().lastClaim).toBeNull()
    expect(res.json().verifiedCount).toBe(0)
    expect(res.json().totalCount).toBe(0)
  })

  it('404s on an objective that does not exist', async () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const bus = new EventBus(db)
    const app = buildApp({ db, bus })
    const res = await app.inject({ method: 'GET', url: '/api/objectives/nope/continuation-seed' })
    expect(res.statusCode).toBe(404)
  })
})
