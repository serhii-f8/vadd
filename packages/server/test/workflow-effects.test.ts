import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent, VerificationSpec } from '@vadd/core'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortFactory } from '../src/agent/registry.js'
import { AgentRegistry } from '../src/agent/registry.js'
import type { ContractEmission } from '../src/contract/pipeline.js'
import { createDb, type Db } from '../src/db/client.js'
import {
  decisions,
  events,
  evidenceItems,
  objectives,
  planTasks,
  projects,
} from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { WorkflowRunner } from '../src/workflow/runner.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

const STATUS_EVENT: AgentEvent = { type: 'status', phase: 'exploring', headline: 'Looking around' }

const DECISION_EVENT: AgentEvent = {
  type: 'decision_needed',
  question: 'Which approach?',
  options: [
    {
      id: 'a',
      label: 'Option A',
      pros: [],
      cons: [],
      reversibility: 'high',
      verification: 'tests pass',
    },
    {
      id: 'b',
      label: 'Option B',
      pros: [],
      cons: [],
      reversibility: 'high',
      verification: 'tests pass',
    },
  ],
  recommendedId: 'a',
}

const PLAN_EVENT: AgentEvent = {
  type: 'plan',
  tasks: [
    { title: 'Write a failing test', description: 'Add a failing test for the bug' },
    { title: 'Fix it', description: 'Make the test pass' },
  ],
}

// `run` is a local no-op, not `npm test`: the collector is bound now, so
// entering `verifying` really executes this in the temp worktree.
const SAMPLE_SPEC: VerificationSpec = {
  verify: {
    setup: [],
    commands: [{ id: 'test', run: 'exit 0', required: true, allowWarn: false, cwd: '.' }],
    checks: [],
    timeoutSec: 600,
  },
  policy: { protectedGlobs: [], maxFastFixLines: 150 },
}

/** The same spec plus one acceptance check, so `check-0` is a declared id. */
const SPEC_WITH_CHECK: VerificationSpec = {
  ...SAMPLE_SPEC,
  verify: { ...SAMPLE_SPEC.verify, checks: ['Bug is reproduced by a failing test'] },
}

const EXECUTE_TASK_OK: AgentEvent[] = [
  { type: 'evidence', kind: 'test', status: 'pass', headline: 'ok', summary: [] },
  { type: 'task_result', taskId: 'task-0', claim: 'done', evidenceRefs: ['ok'] },
]

function evidenceEmission(
  fields: Omit<Extract<AgentEvent, { type: 'evidence' }>, 'type' | 'summary'>,
): ContractEmission {
  return {
    kind: 'event',
    turnId: 't',
    extracted: false,
    sourceEventIds: [1],
    event: { type: 'evidence', summary: [], ...fields },
  }
}

/**
 * Modeled on workflow-runner.test.ts's `stubFactory`, extended with a FIFO
 * queue of canned event batches. `prompt()` calls happen in a strict,
 * deterministic phase order (explore, propose, plan, execute-task, verify,
 * …), so a whole drive's events can be queued up front — each `prompt()`
 * call shifts its own batch off the front, regardless of exactly when,
 * relative to a settle's microtask drain, that call actually happens.
 */
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
    /** Pushes whole batches onto the queue, in the order they'll be consumed. */
    queueEvents: (...batches: AgentEvent[][]) => {
      eventQueue.push(...batches)
    },
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
  const wt = makeTempRepo()
  const { factory, promptCalls, queueEvents, settleNext } = stubFactory()

  // Late binding, same as workflow-runner.test.ts: the registry's
  // onContractEmission hook needs the runner, and the runner's constructor
  // needs the registry.
  let runner!: WorkflowRunner
  const agents = new AgentRegistry(db, bus, factory, (objectiveId, emission) => {
    runner.ingest(objectiveId, emission)
  })
  runner = new WorkflowRunner({ db, bus, agents })

  const promptedPhases: string[] = []
  let lastPromptText = ''
  bus.subscribe(null, (e) => {
    if (e.type === 'prompt_sent') {
      const payload = e.payload as { text: string; phase?: string }
      if (payload.phase) promptedPhases.push(payload.phase)
      lastPromptText = payload.text
    }
  })

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
    wt,
    promptCalls,
    queueEvents,
    settleNext,
    promptedPhases: () => promptedPhases,
    lastPromptText: () => lastPromptText,
    objective: { id: 'o', worktreePath: wt },
  }
}

describe('bindEffects', () => {
  let db: Db
  let runner: WorkflowRunner
  let wt: string
  let promptCalls: () => number
  let queueEvents: (...batches: AgentEvent[][]) => void
  let settleNext: () => void
  let promptedPhases: () => string[]
  let lastPromptText: () => string

  beforeEach(async () => {
    const ctx = setup()
    db = ctx.db
    runner = ctx.runner
    wt = ctx.wt
    promptCalls = ctx.promptCalls
    queueEvents = ctx.queueEvents
    settleNext = ctx.settleNext
    promptedPhases = ctx.promptedPhases
    lastPromptText = ctx.lastPromptText
    // A live agent session has to exist before any turn can run.
    await ctx.agents.ensure(ctx.objective)
  })

  function emitFromPipeline(objectiveId: string, emission: ContractEmission): void {
    runner.ingest(objectiveId, emission)
  }

  /**
   * Settles the oldest still-pending fake prompt, then drains the microtask
   * queue so the settle's full consequence — pipeline settle/endTurn, the
   * runner's TURN_FINISHED send, the machine's transition, and (if the new
   * state also sends a prompt) the *next* turn's `prompt()` call landing in
   * the resolver queue — has actually happened before the caller proceeds.
   * Copied from workflow-runner.test.ts's helper of the same name.
   */
  async function settleFakeTurn(): Promise<void> {
    settleNext()
    for (let i = 0; i < 25; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  }

  async function toAwaitingDecision(): Promise<void> {
    runner.start('o')
    queueEvents([STATUS_EVENT], [DECISION_EVENT])
    runner.send('o', { type: 'START' })
    await settleFakeTurn() // explore settles -> propose's prompt() is called
    await settleFakeTurn() // propose settles -> awaitingDecision
  }

  async function toAwaitingPlanApproval(): Promise<void> {
    await toAwaitingDecision()
    queueEvents([PLAN_EVENT])
    const decision = db.select().from(decisions).all()[0]
    if (!decision) throw new Error('expected a decision row before DECIDE')
    runner.send('o', { type: 'DECIDE', decisionId: decision.id, optionId: decision.recommendedId })
    await settleFakeTurn() // plan settles -> awaitingPlanApproval
  }

  /**
   * Drives to `executing` for task 0. `executeTaskBatch` is queued for that
   * task's own turn but deliberately left unsettled — most tests here only
   * need the entry actions (`checkpoint`, `sendPrompt`) to have fired, not
   * the turn to complete.
   */
  async function toExecuting(executeTaskBatch: AgentEvent[] = []): Promise<void> {
    await toAwaitingPlanApproval()
    // Something for checkpoint's `git add -A` to find — a clean tree would
    // make `checkpointCommit` return null instead of a real sha.
    writeFileSync(join(wt, 'touched.txt'), 'original')
    queueEvents(executeTaskBatch)
    runner.send('o', { type: 'APPROVE_PLAN' })
    // explore, propose, plan, execute-task(task 0) — checkpoint gates the
    // last of these, so this also proves checkpoint resolved.
    await vi.waitFor(() => expect(promptCalls()).toBeGreaterThanOrEqual(4))
  }

  it('sendPrompt runs a turn with the phase the machine named', async () => {
    runner.start('o')
    runner.send('o', { type: 'START' })
    await vi.waitFor(() => expect(promptedPhases()).toEqual(['explore']))
  })

  it('execute-task is rendered with the current task, not tasks[0]', async () => {
    db.update(objectives).set({ verificationSpec: SAMPLE_SPEC }).where(eq(objectives.id, 'o')).run()
    await toExecuting(EXECUTE_TASK_OK)

    // settles execute-task(task 0) -> verifying, which invokes the collector.
    // The spec declares no checks, so there is no verify prompt: the collector
    // finishes, reconcileEvidence sends EVIDENCE_RESULT, and a green set lands
    // in awaitingReview without the agent being asked anything.
    await settleFakeTurn()
    await vi.waitFor(() => expect(runner.get('o')?.getSnapshot().value).toBe('awaitingReview'))

    // hasMoreTasks -> executing again, currentTaskIndex now 1 (task "Fix it")
    runner.send('o', { type: 'APPROVE_TASK' })

    await vi.waitFor(() => expect(promptCalls()).toBeGreaterThanOrEqual(5))
    expect(lastPromptText()).toContain('Fix it')
    expect(lastPromptText()).not.toContain('Write a failing test')
  })

  it('recordPlan writes plan_tasks rows in order', async () => {
    await toAwaitingPlanApproval()
    const rows = db.select().from(planTasks).orderBy(planTasks.ord).all()
    expect(rows.map((r) => r.title)).toEqual(['Write a failing test', 'Fix it'])
    expect(rows.every((r) => r.status === 'pending')).toBe(true)
  })

  it('A10: REVISE from awaitingPlanApproval re-prompts planning with the note, and records the re-plan', async () => {
    await toAwaitingPlanApproval()

    queueEvents([
      { type: 'plan', tasks: [{ title: 'Split part one', description: 'do part one' }] },
    ])
    runner.send('o', { type: 'REVISE', instruction: 'Split task one into two' })
    expect(runner.get('o')?.getSnapshot().value).toBe('planning')

    await vi.waitFor(() => expect(promptCalls()).toBeGreaterThanOrEqual(4))
    expect(lastPromptText()).toContain('Split task one into two')

    await settleFakeTurn() // plan settles -> awaitingPlanApproval
    expect(runner.get('o')?.getSnapshot().value).toBe('awaitingPlanApproval')
    expect(runner.get('o')?.getSnapshot().context.reviseInstruction).toBeNull()
    const rows = db.select().from(planTasks).orderBy(planTasks.ord).all()
    expect(rows.map((r) => r.title)).toEqual(['Split part one'])
  })

  it('A11: the plan prompt lists the resolved verification command ids', async () => {
    db.update(objectives).set({ verificationSpec: SAMPLE_SPEC }).where(eq(objectives.id, 'o')).run()
    await toAwaitingPlanApproval()
    expect(lastPromptText()).toContain('test')
  })

  it('A11: a REVISE re-plan still carries the command ids alongside the revision note', async () => {
    db.update(objectives).set({ verificationSpec: SAMPLE_SPEC }).where(eq(objectives.id, 'o')).run()
    await toAwaitingPlanApproval()

    queueEvents([
      { type: 'plan', tasks: [{ title: 'Split part one', description: 'do part one' }] },
    ])
    runner.send('o', { type: 'REVISE', instruction: 'Split task one into two' })

    await vi.waitFor(() => expect(promptedPhases().filter((p) => p === 'plan').length).toBe(2))
    expect(lastPromptText()).toContain('Split task one into two')
    expect(lastPromptText()).toContain('test')
  })

  it('A11: plan phase renders with no unresolved placeholder when no verificationSpec is set', async () => {
    // The default state in this file's fixtures — no explicit update to
    // objectives.verificationSpec, so it stays null.
    await toAwaitingPlanApproval()
    expect(lastPromptText()).not.toContain('{{')
  })

  it('recordDecision writes a decisions row, and DECIDE fills in the choice', async () => {
    await toAwaitingDecision()
    const before = db.select().from(decisions).all()[0]
    if (!before) throw new Error('expected a decisions row')
    expect(before.chosenId).toBeNull()
    runner.send('o', { type: 'DECIDE', decisionId: before.id, optionId: 'a' })
    const after = db.select().from(decisions).all()[0]
    expect(after?.chosenId).toBe('a')
    expect(after?.decidedBy).toBe('user')
    expect(after?.decidedAt).not.toBeNull()
  })

  it('recordEvidence writes an evidence_items row with a null commandId', async () => {
    await toExecuting()
    emitFromPipeline('o', evidenceEmission({ kind: 'test', status: 'pass', headline: '12 passed' }))
    const row = db.select().from(evidenceItems).all()[0]
    expect(row?.commandId).toBeNull() // amendment A5: agent claims close nothing
    expect(row?.taskId).not.toBeNull()
  })

  it('A6: a check evidence carrying a recognised checkId links to the check', async () => {
    db.update(objectives)
      .set({ verificationSpec: SPEC_WITH_CHECK })
      .where(eq(objectives.id, 'o'))
      .run()
    await toExecuting()
    emitFromPipeline(
      'o',
      evidenceEmission({
        kind: 'check',
        checkId: 'check-0',
        status: 'pass',
        headline: 'Reproduced',
      }),
    )
    expect(db.select().from(evidenceItems).all()[0]?.commandId).toBe('check-0')
  })

  it('an unrecognised checkId is ignored, not guessed at', async () => {
    db.update(objectives)
      .set({ verificationSpec: SPEC_WITH_CHECK })
      .where(eq(objectives.id, 'o'))
      .run()
    await toExecuting()
    emitFromPipeline(
      'o',
      evidenceEmission({ kind: 'check', checkId: 'check-99', status: 'pass', headline: 'x' }),
    )
    expect(db.select().from(evidenceItems).all()[0]?.commandId).toBeNull()
  })

  it('a non-check kind never sets commandId, even with a checkId', async () => {
    db.update(objectives)
      .set({ verificationSpec: SPEC_WITH_CHECK })
      .where(eq(objectives.id, 'o'))
      .run()
    await toExecuting()
    emitFromPipeline(
      'o',
      evidenceEmission({ kind: 'test', checkId: 'check-0', status: 'pass', headline: 'x' }),
    )
    expect(db.select().from(evidenceItems).all()[0]?.commandId).toBeNull()
  })

  it('checkpoint commits the worktree and stores the sha on the task row', async () => {
    await toExecuting()
    const row = db.select().from(planTasks).orderBy(planTasks.ord).all()[0]
    expect(row?.checkpointRef).toMatch(/^[0-9a-f]{7,40}$/)
    expect(row?.status).toBe('running')
  })

  it('rollbackToCheckpoint resets the worktree to that sha', async () => {
    await toExecuting()
    writeFileSync(join(wt, 'touched.txt'), 'dirty')
    runner.send('o', { type: 'TURN_FAILED', reason: 'error', message: 'x' })
    runner.send('o', { type: 'ROLLBACK' })
    await vi.waitFor(() => expect(readFileSync(join(wt, 'touched.txt'), 'utf8')).toBe('original'))
  })

  it('a checkpoint failure pauses rather than proceeding on an unprotected tree', async () => {
    await toAwaitingPlanApproval()
    const badPath = mkdtempSync(join(tmpdir(), 'vadd-notrepo-'))
    db.update(objectives).set({ worktreePath: badPath }).where(eq(objectives.id, 'o')).run()

    runner.send('o', { type: 'APPROVE_PLAN' })

    await vi.waitFor(() => expect(runner.get('o')?.getSnapshot().value).toBe('paused'))
    const types = db
      .select()
      .from(events)
      .all()
      .map((e) => e.type)
    expect(types).toContain('checkpoint_failed')
  })

  it('a null verificationSpec pauses rather than running nothing and calling it green', async () => {
    // Objective 'o' keeps its default null verificationSpec. The collector
    // refuses to run against one, so the invoke's onError pauses — it never
    // reports an empty set that would read as a real (red) verdict, and never
    // renders a template whose placeholder has no value.
    await toExecuting(EXECUTE_TASK_OK)
    await settleFakeTurn() // settles execute-task(task 0) -> verifying entry -> the collector refuses

    await vi.waitFor(() => expect(runner.get('o')?.getSnapshot().value).toBe('paused'))
    const rows = db.select().from(events).all()
    expect(rows.map((r) => r.type)).toContain('verification_unresolved')
    expect(
      rows.some(
        (r) => r.type === 'prompt_sent' && (r.payload as { phase?: string }).phase === 'verify',
      ),
    ).toBe(false)
  })
})
