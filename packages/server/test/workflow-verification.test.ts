import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent, VerificationSpec } from '@vadd/core'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { PortFactory } from '../src/agent/registry.js'
import { AgentRegistry } from '../src/agent/registry.js'
import { createDb, type Db } from '../src/db/client.js'
import { decisions, evidenceItems, objectives, projects } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { WorkflowRunner } from '../src/workflow/runner.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

const STATUS_EVENT: AgentEvent = { type: 'status', phase: 'exploring', headline: 'Looking around' }

const EXECUTE_TASK_OK: AgentEvent[] = [
  { type: 'evidence', kind: 'test', status: 'pass', headline: 'ok', summary: [] },
  { type: 'task_result', taskId: '0', claim: 'done', evidenceRefs: ['ok'] },
]

/** Satisfies verify.md's `expects`; the guard is a separate question. */
const CHECK_CLAIM: AgentEvent[] = [
  { type: 'evidence', kind: 'check', status: 'pass', headline: 'Reproduced', summary: [] },
]

const DECISION_EVENT: AgentEvent = {
  type: 'decision_needed',
  question: 'Which approach?',
  options: [
    { id: 'a', label: 'A', pros: [], cons: [], reversibility: 'high', verification: 'tests pass' },
    { id: 'b', label: 'B', pros: [], cons: [], reversibility: 'high', verification: 'tests pass' },
  ],
  recommendedId: 'a',
}

/** One task, so `APPROVE_TASK` from `awaitingReview` goes straight to `integrating`. */
const PLAN_EVENT: AgentEvent = {
  type: 'plan',
  tasks: [{ title: 'Fix it', description: 'Make the failing test pass' }],
}

function specWith(run: string, checks: string[] = [], timeoutSec = 600): VerificationSpec {
  return {
    verify: {
      setup: [],
      commands: [{ id: 'test', run, required: true, allowWarn: false, cwd: '.' }],
      checks,
      timeoutSec,
    },
    policy: { protectedGlobs: [], maxFastFixLines: 150 },
  }
}

/** Modelled on workflow-effects.test.ts's stub — read that file first. */
function stubFactory() {
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

async function setup(spec: VerificationSpec | null) {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const wt = makeTempRepo()
  const { factory, promptCalls, queueEvents, settleNext } = stubFactory()

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
      worktreePath: wt,
      branchName: 'vadd/o',
      status: 'idle',
      mode: 'standard',
      verificationSpec: spec,
      lowEnergy: false,
      setupAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  await agents.ensure({ id: 'o', worktreePath: wt })

  async function settleFakeTurn(): Promise<void> {
    settleNext()
    for (let i = 0; i < 25; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  }

  const stateOf = () => String(runner.get('o')?.getSnapshot().value)

  /**
   * Settles the verify turn a spec with checks takes. Waits on the prompt
   * count first: the collector runs real subprocesses, so the verify prompt
   * lands some milliseconds after `verifying` is entered.
   */
  async function settleVerifyTurn(): Promise<void> {
    await vi.waitFor(() => expect(promptCalls()).toBeGreaterThanOrEqual(5))
    await settleFakeTurn()
  }

  /**
   * Drives all the way to `verifying`, where the collector takes over.
   *
   * Every batch satisfies its template's `expects`. An unmet `expects` fires
   * A4's repair prompt, which is another `prompt()` call — it would shift the
   * whole queue and settle the wrong turn.
   */
  async function driveToVerifying(verifyBatch: AgentEvent[] = []): Promise<void> {
    runner.start('o')
    // The verify batch is queued here too, not by the caller afterwards: the
    // collector is a real subprocess, so `prompt('verify')` lands at an
    // unpredictable moment and a later push could miss it.
    queueEvents([STATUS_EVENT], [DECISION_EVENT], [PLAN_EVENT], EXECUTE_TASK_OK)
    // Only when the spec has checks — with none there is no verify turn, and a
    // queued batch nobody consumes would be handed to the *next* turn instead.
    if (verifyBatch.length > 0) queueEvents(verifyBatch)
    runner.send('o', { type: 'START' })
    await settleFakeTurn() // explore -> proposing
    await settleFakeTurn() // propose -> awaitingDecision
    const decision = db.select().from(decisions).all()[0]
    if (!decision) throw new Error('expected a decisions row before DECIDE')
    runner.send('o', { type: 'DECIDE', decisionId: decision.id, optionId: 'a' })
    await settleFakeTurn() // plan -> awaitingPlanApproval
    // Something for the checkpoint's `git add -A` to find.
    writeFileSync(join(wt, 'touched.txt'), 'original')
    runner.send('o', { type: 'APPROVE_PLAN' })
    // Waiting on the *prompt count*, not the state: `checkpoint` is async and
    // `sendPrompt` awaits it, so `executing` is reached well before the
    // execute-task turn exists to be settled.
    await vi.waitFor(() => expect(promptCalls()).toBeGreaterThanOrEqual(4))
    await settleFakeTurn() // execute-task -> verifying, which invokes the collector
  }

  return {
    db,
    bus,
    agents,
    runner,
    wt,
    promptCalls,
    queueEvents,
    settleFakeTurn,
    settleVerifyTurn,
    stateOf,
    driveToVerifying,
  }
}

describe('bound verification', () => {
  it('runs the spec commands and reaches awaitingReview on a green set', async () => {
    const t = await setup(specWith('exit 0'))
    await t.driveToVerifying()
    await vi.waitFor(() => expect(t.stateOf()).toBe('awaitingReview'))

    // The agent's own execute-task evidence is in the table as well, with a
    // null commandId — displayed, but closing nothing (amendment A5).
    const collected = t.db
      .select()
      .from(evidenceItems)
      .all()
      .filter((r) => r.commandId !== null)
    expect(collected.map((r) => r.commandId)).toEqual(['test'])
    expect(collected[0]?.status).toBe('pass')
  })

  it('pauses on a red set, and the objective cannot reach done', async () => {
    const t = await setup(specWith('exit 1'))
    await t.driveToVerifying()
    await vi.waitFor(() => expect(t.stateOf()).toBe('paused'))
  })

  it('an objective reaches done through a full green evidence set', async () => {
    const t = await setup(specWith('exit 0'))
    await t.driveToVerifying()
    await vi.waitFor(() => expect(t.stateOf()).toBe('awaitingReview'))

    t.runner.send('o', { type: 'APPROVE_TASK' })
    expect(t.stateOf()).toBe('integrating')
    t.runner.send('o', { type: 'INTEGRATE', action: 'keep' })

    const row = t.db.select().from(objectives).where(eq(objectives.id, 'o')).get()
    expect(row?.status).toBe('done')
  })

  it('a green run before a ROLLBACK does not satisfy the guard after a red one', async () => {
    const t = await setup(specWith('exit 0'))
    await t.driveToVerifying()
    await vi.waitFor(() => expect(t.stateOf()).toBe('awaitingReview'))

    // Roll back, then re-verify with a command that now fails.
    t.queueEvents(EXECUTE_TASK_OK)
    t.runner.send('o', { type: 'ROLLBACK' })
    await vi.waitFor(() => expect(t.promptCalls()).toBeGreaterThanOrEqual(5))
    t.db
      .update(objectives)
      .set({ verificationSpec: specWith('exit 1') })
      .where(eq(objectives.id, 'o'))
      .run()
    await t.settleFakeTurn()

    await vi.waitFor(() => expect(t.stateOf()).toBe('paused'))
    // The stale green row is still in the table — it just must not count.
    expect(t.db.select().from(evidenceItems).all().length).toBeGreaterThan(1)
  })

  it('a check row satisfies its check and survives a re-verify', async () => {
    const t = await setup(specWith('exit 0', ['Bug reproduced by a failing test']))
    // This spec has checks, so `verifying` takes a verify turn as well.
    await t.driveToVerifying(CHECK_CLAIM)
    // The command is green but nothing claims the check yet.
    await t.settleVerifyTurn() // verify turn closes -> reconcile -> still short a check
    await vi.waitFor(() => expect(t.stateOf()).toBe('paused'))

    tickCheck(t.db, 'check-0', 'pass')

    // RESUME re-enters verifying: the commands re-run, the tick does not.
    t.queueEvents(CHECK_CLAIM)
    t.runner.send('o', { type: 'RESUME' })
    await vi.waitFor(() => expect(t.promptCalls()).toBeGreaterThanOrEqual(6))
    await t.settleFakeTurn()
    await vi.waitFor(() => expect(t.stateOf()).toBe('awaitingReview'))
  })

  it('a check row from before the last executing entry does not count', async () => {
    const t = await setup(specWith('exit 0', ['Bug reproduced by a failing test']))
    // Ticked before any `executing` entry, so it predates every epoch.
    tickCheck(t.db, 'check-0', 'pass')

    await t.driveToVerifying(CHECK_CLAIM)
    await t.settleVerifyTurn()
    await vi.waitFor(() => expect(t.stateOf()).toBe('paused'))
  })

  it('PAUSE during a long suite aborts it rather than leaving it running', async () => {
    const t = await setup(specWith('sleep 30'))
    await t.driveToVerifying()
    await vi.waitFor(() => expect(t.stateOf()).toBe('verifying'))

    t.runner.send('o', { type: 'PAUSE' })
    await vi.waitFor(() => expect(t.stateOf()).toBe('paused'))
    // No row for the aborted command — a killed suite produced no verdict.
    // (The agent's own execute-task evidence, commandId null, is unaffected.)
    await vi.waitFor(() =>
      expect(
        t.db
          .select()
          .from(evidenceItems)
          .all()
          .filter((r) => r.commandId !== null),
      ).toHaveLength(0),
    )
  })
})

/** What phase 4's Task 11 `tick_check` writes: a user-decided check row. */
function tickCheck(db: Db, checkId: string, status: 'pass' | 'fail'): void {
  db.insert(evidenceItems)
    .values({
      id: randomUUID(),
      objectiveId: 'o',
      taskId: null,
      commandId: checkId,
      kind: 'check',
      status,
      headline: 'Confirmed by the user',
      summary: [],
      artifactPath: null,
      decidedBy: 'user',
      createdAt: new Date().toISOString(),
    })
    .run()
}
