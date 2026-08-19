import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortFactory } from '../src/agent/registry.js'
import { AgentRegistry } from '../src/agent/registry.js'
import type { ContractEmission } from '../src/contract/pipeline.js'
import { createDb, type Db } from '../src/db/client.js'
import { events, objectives, projects, settings } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { WorkflowRunner } from '../src/workflow/runner.js'
import { loadSnapshot } from '../src/workflow/store.js'
import { withTempHome } from './fixtures/temp-repo.js'

/**
 * Modeled on registry.test.ts's `stubFactory` and workflow-turn.test.ts's
 * extension of it (read both first, per the brief). Neither of those gives a
 * *controllable* settle point — registry.test.ts's always resolves
 * immediately, workflow-turn.test.ts's is either immediate or never resolves
 * at all — and this file's tests need to assert on the state *between*
 * `sendPrompt` firing and the turn settling, so `prompt()` here returns a
 * promise this file's `settleFakeTurn()` resolves on demand.
 *
 * `prompt()` also emits one valid `status` event synchronously, the same way
 * workflow-turn.test.ts's 'immediate' stub does, through the `onUpdate`
 * callback `AgentRegistry` wires at `ensure()` time — the real pipeline
 * ingestion path. That satisfies `explore`'s and `review`'s `expects`; a
 * `propose`/`plan` turn's `expects` still goes unmet (they want
 * `decision_needed`/`plan`, not `status`), which just exercises the
 * pipeline's existing no-repair-heuristics fallback (turn.ts's repair prompt,
 * itself another `prompt()` call this stub answers the same way) — nothing
 * in this file needs those turns to structurally succeed, only to not hang
 * past what a test actually settles.
 */
function stubFactory() {
  let promptCalls = 0
  let cancelCalls = 0
  let onUpdate: ((u: unknown) => void) | undefined
  const resolvers: Array<(v: { stopReason: string }) => void> = []

  const factory: PortFactory = () => {
    const port = {
      async start() {},
      async newSession() {
        return { sessionId: 'session-1' }
      },
      async prompt(sessionId: string) {
        promptCalls += 1
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
        return new Promise<{ stopReason: string }>((resolve) => {
          resolvers.push(resolve)
        })
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

  return {
    factory,
    promptCalls: () => promptCalls,
    cancelCalls: () => cancelCalls,
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
  const { factory, promptCalls, cancelCalls, settleNext } = stubFactory()

  // Late binding, per the plan's note on this exact cycle: the registry's
  // onContractEmission hook needs the runner, and the runner's constructor
  // needs the registry. `runner` is assigned immediately after construction,
  // before anything (a real `ensure()`/`prompt()` cycle, or this file's
  // `emitFromPipeline`) can call the hook.
  let runner!: WorkflowRunner
  const agents = new AgentRegistry(db, bus, factory, (objectiveId, emission) => {
    runner.ingest(objectiveId, emission)
  })
  runner = new WorkflowRunner({ db, bus, agents })

  const now = new Date().toISOString()
  db.insert(projects)
    .values({ id: 'proj-1', name: 'p', repoPath: `${home}/repo`, config: {}, createdAt: now })
    .run()
  db.insert(objectives)
    .values({
      id: 'o',
      projectId: 'proj-1',
      title: 't',
      goalText: 'g',
      worktreePath: `${home}/wt`,
      branchName: 'vadd/o',
      status: 'idle',
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return {
    db,
    bus,
    agents,
    runner,
    promptCalls,
    cancelCalls,
    settleNext,
    objective: { id: 'o', worktreePath: `${home}/wt`, projectId: 'proj-1' },
  }
}

describe('WorkflowRunner', () => {
  let db: Db
  let runner: WorkflowRunner
  let promptCalls: () => number
  let settleNext: () => void

  beforeEach(async () => {
    const ctx = setup()
    db = ctx.db
    runner = ctx.runner
    promptCalls = ctx.promptCalls
    settleNext = ctx.settleNext
    // A live agent session has to exist before any turn can run — the same
    // precondition runTurn.ts's own tests set up before calling runTurn.
    await ctx.agents.ensure(ctx.objective)
  })

  function emitFromPipeline(objectiveId: string, emission: ContractEmission): void {
    runner.ingest(objectiveId, emission)
  }

  /**
   * Settles the oldest still-pending fake prompt, then drains the
   * microtask queue (a single macrotask boundary flushes every chained
   * microtask Node has queued, however many `await`s deep) so the settle's
   * full consequence — pipeline settle/endTurn, the runner's TURN_FINISHED
   * send, the machine's transition, and (if the new state also sends a
   * prompt) the *next* turn's `prompt()` call landing in the resolver queue
   * — has actually happened before the test asserts on it.
   */
  async function settleFakeTurn(): Promise<void> {
    settleNext()
    for (let i = 0; i < 25; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  }

  it('starts an actor in idle and persists a snapshot for it', () => {
    runner.start('o')
    expect(runner.get('o')?.getSnapshot().value).toBe('idle')
    expect(loadSnapshot(db, 'o')).toBeTruthy()
    expect(db.select().from(objectives).all()[0]?.status).toBe('idle')
  })

  it('persists a snapshot and a state_changed event on every transition', () => {
    runner.start('o')
    runner.send('o', { type: 'START' })
    expect(db.select().from(objectives).all()[0]?.status).toBe('exploring')
    const types = db
      .select()
      .from(events)
      .all()
      .map((e) => e.type)
    expect(types.filter((t) => t === 'state_changed')).toHaveLength(2)
  })

  it('feeds validated AgentEvents from the pipeline to the actor', () => {
    runner.start('o')
    runner.send('o', { type: 'START' })
    emitFromPipeline('o', {
      kind: 'event',
      turnId: 't',
      extracted: false,
      sourceEventIds: [1],
      event: { type: 'clarification', question: 'which?', suggestedAnswers: [] },
    })
    runner.send('o', { type: 'TURN_FINISHED' })
    expect(runner.get('o')?.getSnapshot().value).toBe('clarifying')
  })

  it('drops contract violations — a violation is a row, not a machine input', () => {
    runner.start('o')
    runner.send('o', { type: 'START' })
    emitFromPipeline('o', {
      kind: 'violation',
      turnId: 't',
      reason: 'schema',
      raw: '{}',
      sourceEventIds: [1],
    })
    expect(runner.get('o')?.getSnapshot().value).toBe('exploring')
  })

  it('sends TURN_FINISHED when a turn settles, exactly once', async () => {
    runner.start('o')
    runner.send('o', { type: 'START' })
    await settleFakeTurn()
    expect(runner.get('o')?.getSnapshot().value).toBe('proposing')
    await settleFakeTurn()
    // A second settle for the same turn must not double-advance.
    expect(runner.get('o')?.getSnapshot().value).not.toBe('planning')
  })

  it('sends TURN_FAILED with reason timeout when runTurn reports one', async () => {
    // 20ms, not an arbitrary small number: turn.ts's timeout message is
    // `Turn exceeded ${timeoutMs}ms`, and the assertion below matches on the
    // literal "20" this produces.
    db.insert(settings).values({ key: 'turnTimeoutSec', value: 0.02 }).run()
    // wedged fake peer (this file's stub never resolves prompt() unless
    // settleNext() is called), short timeout
    runner.start('o')
    runner.send('o', { type: 'START' })
    await vi.waitFor(() => expect(runner.get('o')?.getSnapshot().value).toBe('paused'))
    expect(runner.get('o')?.getSnapshot().context.lastFailure?.probableCause).toMatch(/timeout|20/)
  })

  it('rebuilds an actor from a persisted snapshot without re-firing entry effects', () => {
    runner.start('o')
    runner.send('o', { type: 'START' })
    const promptsBefore = promptCalls()
    const snapshot = loadSnapshot(db, 'o')
    runner.stop('o')
    runner.resume('o', snapshot)
    expect(runner.get('o')?.getSnapshot().value).toBe('exploring')
    // Design §10: "assert the resumed state and that no duplicate side effect fires."
    expect(promptCalls()).toBe(promptsBefore)
  })

  it('an old turn settling after stop+resume does not advance the resumed actor', async () => {
    // Concrete proof of the double-advance guard `#activeRun` exists for:
    // the explore turn kicked off by START is still in flight (its prompt()
    // is pending) when stop() runs. resume() rebuilds the actor without
    // re-firing sendPrompt, so nothing *new* is in flight either. If the
    // stale turn's eventual settle were allowed to reach the machine, it
    // would send TURN_FINISHED and exploring→proposing would fire on an
    // actor that never asked for it.
    runner.start('o')
    runner.send('o', { type: 'START' })
    const snapshot = loadSnapshot(db, 'o')
    runner.stop('o')
    runner.resume('o', snapshot)
    await settleFakeTurn()
    expect(runner.get('o')?.getSnapshot().value).toBe('exploring')
  })

  it('does not resurrect a terminal objective', () => {
    runner.start('o')
    runner.send('o', { type: 'CANCEL' })
    expect(db.select().from(objectives).all()[0]?.status).toBe('cancelled')
    expect(runner.get('o')).toBeUndefined()
  })
})
