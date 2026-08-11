import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PortFactory } from '../src/agent/registry.js'
import { AgentRegistry } from '../src/agent/registry.js'
import { rehydrateOnBoot } from '../src/boot/rehydrate.js'
import { createDb, type Db } from '../src/db/client.js'
import { machineSnapshots, objectives, projects } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { WorkflowRunner } from '../src/workflow/runner.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

let promptCalls = 0

const stub: PortFactory = () =>
  ({
    async start() {},
    async newSession() {
      return { sessionId: 'session-1' }
    },
    async prompt() {
      promptCalls += 1
      return new Promise<{ stopReason: string }>(() => {})
    },
    async cancel() {},
    async stop() {},
    onUpdate: () => () => {},
    onExit: () => () => {},
  }) as unknown as ReturnType<PortFactory>

type Ctx = { db: Db; bus: EventBus; runner: WorkflowRunner; home: string }

function setup(): Ctx {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  let runner!: WorkflowRunner
  const agents = new AgentRegistry(db, bus, stub, (id, e) => runner.ingest(id, e))
  runner = new WorkflowRunner({ db, bus, agents })
  db.insert(projects)
    .values({ id: 'p', name: 'p', repoPath: `${home}/repo`, config: {}, createdAt: 'now' })
    .run()
  return { db, bus, runner, home }
}

function seed(ctx: Ctx, id: string, status: string): void {
  ctx.db
    .insert(objectives)
    .values({
      id,
      projectId: 'p',
      title: 't',
      goalText: 'g',
      worktreePath: `${ctx.home}/wt-${id}`,
      branchName: `vadd/${id}`,
      status,
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: 'now',
      updatedAt: 'now',
    })
    .run()
}

/**
 * Builds a real persisted snapshot by driving a throwaway actor to `state`,
 * then copying its `machine_snapshots` row onto `id`.
 *
 * Hand-writing a snapshot object would test rehydration against a shape xstate
 * does not actually produce — and `createActor(machine, { snapshot })` is
 * exactly the code path that would then be lying.
 */
function seedWithSnapshot(ctx: Ctx, id: string, state: string): void {
  seed(ctx, id, 'idle')
  const actor = ctx.runner.start(id)
  if (state !== 'idle') {
    actor.send({ type: 'START' })
    if (state !== 'exploring') actor.send({ type: 'TURN_FINISHED' })
  }
  ctx.runner.stop(id)
  ctx.db.update(objectives).set({ status: state }).where(eq(objectives.id, id)).run()
  promptCalls = 0
}

/**
 * Drives an objective all the way to `executing` and stops the actor there,
 * leaving a genuine mid-turn snapshot behind.
 *
 * Deliberately not a hand-patched snapshot object: `value` is not the only
 * thing a crash in `executing` leaves behind — `context.resumeState`,
 * `context.tasks` and `currentTaskIndex` all matter to what rehydration is
 * supposed to recover, and patching one field produces a snapshot xstate never
 * would have written.
 *
 * The worktree is a real git repo because `executing`'s entry runs a real
 * checkpoint commit; against a missing path it would fail and pause the
 * objective before the snapshot under test was ever written.
 */
function seedExecuting(ctx: Ctx, id: string): void {
  ctx.db
    .insert(objectives)
    .values({
      id,
      projectId: 'p',
      title: 't',
      goalText: 'g',
      worktreePath: makeTempRepo(),
      branchName: `vadd/${id}`,
      status: 'idle',
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: 'now',
      updatedAt: 'now',
    })
    .run()

  const actor = ctx.runner.start(id)
  actor.send({ type: 'START' })
  actor.send({ type: 'TURN_FINISHED' }) // exploring -> proposing
  actor.send({
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
  actor.send({ type: 'TURN_FINISHED' }) // proposing -> awaitingDecision
  actor.send({ type: 'DECIDE', decisionId: 'ignored', optionId: 'a' })
  actor.send({
    type: 'PLAN',
    event: { type: 'plan', tasks: [{ title: 'Fix it', description: 'patch' }] },
  })
  actor.send({ type: 'TURN_FINISHED' }) // planning -> awaitingPlanApproval
  actor.send({ type: 'APPROVE_PLAN' }) // -> executing
  if (String(actor.getSnapshot().value) !== 'executing') {
    throw new Error(`expected executing, got ${String(actor.getSnapshot().value)}`)
  }
  ctx.runner.stop(id)
  promptCalls = 0
}

beforeEach(() => {
  promptCalls = 0
})

describe('rehydrateOnBoot', () => {
  it('rebuilds an actor for every non-terminal objective', async () => {
    const ctx = setup()
    seedWithSnapshot(ctx, 'o1', 'exploring')
    seedWithSnapshot(ctx, 'o2', 'proposing')

    const out = await rehydrateOnBoot(ctx)
    expect(out.resumed).toBe(2)
    expect(String(ctx.runner.get('o1')?.getSnapshot().value)).toBe('exploring')
    expect(String(ctx.runner.get('o2')?.getSnapshot().value)).toBe('proposing')
  })

  it('skips done, cancelled and failed', async () => {
    const ctx = setup()
    for (const state of ['done', 'cancelled', 'failed']) {
      seed(ctx, `x-${state}`, state)
      ctx.db
        .insert(machineSnapshots)
        .values({ objectiveId: `x-${state}`, snapshot: { value: state }, updatedAt: 'now' })
        .run()
    }

    const out = await rehydrateOnBoot(ctx)
    expect(out.resumed).toBe(0)
    expect(ctx.runner.get('x-done')).toBeUndefined()
  })

  it('skips `creating`, which boot reconciliation owns', async () => {
    const ctx = setup()
    seed(ctx, 'half-made', 'creating')

    const out = await rehydrateOnBoot(ctx)
    expect(out.resumed).toBe(0)
    expect(ctx.runner.get('half-made')).toBeUndefined()
  })

  it('resumes a crash mid-executing into paused, never back into executing', async () => {
    const ctx = setup()
    seedExecuting(ctx, 'o')
    expect(ctx.db.select().from(objectives).all()[0]?.status).toBe('executing')

    const out = await rehydrateOnBoot(ctx)
    expect(out.pausedAfterCrash).toBe(1)
    expect(String(ctx.runner.get('o')?.getSnapshot().value)).toBe('paused')
    // The return address survives, so the Focus View can offer continue or
    // roll back rather than guessing where the objective was.
    expect(ctx.runner.get('o')?.getSnapshot().context.resumeState).toBe('executing')
    expect(ctx.bus.since('o', 0).map((e) => e.type)).toContain('resumed_after_crash')
  })

  it('fires no prompt while rehydrating', async () => {
    const ctx = setup()
    seedWithSnapshot(ctx, 'o1', 'exploring')
    seedWithSnapshot(ctx, 'o2', 'proposing')

    await rehydrateOnBoot(ctx)
    // Design §10: "assert the resumed state and that no duplicate side effect
    // fires." A rehydrated actor must not re-send the turn it was mid-way
    // through, and must not start a second adapter per objective at boot.
    expect(promptCalls).toBe(0)
  })

  it('leaves an objective with no snapshot alone, and says so', async () => {
    const ctx = setup()
    seed(ctx, 'orphan', 'exploring')

    const out = await rehydrateOnBoot(ctx)
    expect(out.resumed).toBe(0)
    expect(ctx.runner.get('orphan')).toBeUndefined()
    // Silence here would leave a ghost objective nobody can drive and nobody
    // can see is undrivable.
    expect(ctx.bus.since('orphan', 0).map((e) => e.type)).toContain('rehydrate_skipped')
  })

  it('one corrupt snapshot does not abort the rest', async () => {
    const ctx = setup()
    seed(ctx, 'bad', 'exploring')
    ctx.db
      .insert(machineSnapshots)
      .values({ objectiveId: 'bad', snapshot: { nonsense: true }, updatedAt: 'now' })
      .run()
    seedWithSnapshot(ctx, 'good', 'exploring')

    const out = await rehydrateOnBoot(ctx)
    expect(out.resumed).toBe(1)
    expect(String(ctx.runner.get('good')?.getSnapshot().value)).toBe('exploring')
    expect(ctx.bus.since('bad', 0).map((e) => e.type)).toContain('rehydrate_failed')
  })

  it('emits one boot_rehydrated event carrying the counts', async () => {
    const ctx = setup()
    seedWithSnapshot(ctx, 'o1', 'exploring')

    const out = await rehydrateOnBoot(ctx)
    const booted = ctx.bus.since(null, 0).filter((e) => e.type === 'boot_rehydrated')
    expect(booted).toHaveLength(1)
    expect(booted[0]?.payload).toEqual(out)
  })
})
