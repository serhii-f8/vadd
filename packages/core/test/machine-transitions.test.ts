import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise } from 'xstate'
import type { WorkflowEvent } from '../src/machine/types.js'
import { initialContext, workflowMachine } from '../src/machine/workflow-machine.js'
import { VerificationSpec } from '../src/schemas/verification.js'

const spec = VerificationSpec.parse({
  verify: { commands: [{ id: 'test', run: 'pnpm test', required: true }] },
})

const sendPrompt = vi.fn()
const checkpoint = vi.fn()
const rollbackToCheckpoint = vi.fn()
const recordPlan = vi.fn()
const markTaskVerified = vi.fn()
const noteAutoApprovedTask = vi.fn()
const noteAutoApprovedPlan = vi.fn()

const stubbed = workflowMachine.provide({
  actions: { sendPrompt, checkpoint, rollbackToCheckpoint, recordPlan, markTaskVerified },
  // `verifying` invokes the collector (phase 4). `core`'s own implementation
  // throws on purpose — an unprovided collector must fail loudly — so every
  // test that passes through `verifying` provides an inert one here.
  actors: {
    runVerification: fromPromise<
      { runId: string; taskRisk: 'low' | 'high' },
      { objectiveId: string; taskId: string | null }
    >(async () => ({ runId: 'run-stub', taskRisk: 'high' })),
  },
})

function start(mode: 'standard' | 'fastfix' | 'investigation' = 'standard') {
  const actor = createActor(stubbed, {
    input: initialContext({
      objectiveId: 'o1',
      goalText: 'fix the bug',
      mode,
      lowEnergy: false,
      verificationSpec: spec,
    }),
  })
  actor.start()
  return actor
}

const planEvent = {
  type: 'plan',
  tasks: [
    { title: 'Write a failing test', description: 'repro' },
    { title: 'Fix it', description: 'patch' },
  ],
} satisfies Extract<WorkflowEvent, { type: 'PLAN' }>['event']

const planEventWithExpectFailing = {
  type: 'plan',
  tasks: [
    {
      title: 'Write a failing test',
      description: 'repro',
      expectFailing: ['test'],
    },
    { title: 'Fix it', description: 'patch' },
  ],
} satisfies Extract<WorkflowEvent, { type: 'PLAN' }>['event']

const decisionEvent = {
  type: 'decision_needed',
  question: 'which?',
  options: [
    { id: 'a', label: 'A', pros: [], cons: [], reversibility: 'high', verification: 'run tests' },
    { id: 'b', label: 'B', pros: [], cons: [], reversibility: 'low', verification: 'run tests' },
  ],
  recommendedId: 'a',
} satisfies Extract<WorkflowEvent, { type: 'DECISION_NEEDED' }>['event']

beforeEach(() => {
  sendPrompt.mockClear()
  checkpoint.mockClear()
  rollbackToCheckpoint.mockClear()
  recordPlan.mockClear()
  markTaskVerified.mockClear()
  noteAutoApprovedTask.mockClear()
  noteAutoApprovedPlan.mockClear()
})

describe('the happy path', () => {
  it('starts idle and sends the explore prompt on START', () => {
    const actor = start()
    expect(actor.getSnapshot().value).toBe('idle')
    actor.send({ type: 'START' })
    expect(actor.getSnapshot().value).toBe('exploring')
    expect(sendPrompt).toHaveBeenCalledTimes(1)
  })

  it('exploring → proposing when the turn produced no clarification', () => {
    const actor = start()
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('proposing')
  })

  it('exploring → clarifying when the turn asked a question', () => {
    const actor = start()
    actor.send({ type: 'START' })
    actor.send({
      type: 'CLARIFICATION',
      event: { type: 'clarification', question: 'which db?', suggestedAnswers: [] },
    })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('clarifying')
    actor.send({ type: 'ANSWER_CLARIFICATION', answer: 'sqlite' })
    expect(actor.getSnapshot().value).toBe('exploring')
  })

  it('proposing → awaitingDecision → planning', () => {
    const actor = start()
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('awaitingDecision')
    actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
    expect(actor.getSnapshot().value).toBe('planning')
  })

  it('planning → awaitingPlanApproval, and stores the tasks', () => {
    const actor = start()
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
    actor.send({ type: 'PLAN', event: planEvent })
    actor.send({ type: 'TURN_FINISHED' })
    const snap = actor.getSnapshot()
    expect(snap.value).toBe('awaitingPlanApproval')
    expect(snap.context.tasks).toHaveLength(2)
    expect(snap.context.tasks[0]?.title).toBe('Write a failing test')
  })

  it('checkpoints before entering executing', () => {
    const actor = toAwaitingPlanApproval()
    actor.send({ type: 'APPROVE_PLAN' })
    expect(actor.getSnapshot().value).toBe('executing')
    expect(checkpoint).toHaveBeenCalledTimes(1)
  })

  it('APPROVE_PLAN re-records the plan, so an edited list reaches plan_tasks too', () => {
    const actor = toAwaitingPlanApproval()
    recordPlan.mockClear() // toAwaitingPlanApproval's own PLAN event already recorded once
    actor.send({
      type: 'APPROVE_PLAN',
      tasks: [
        { id: 'o1-0', ord: 0, title: 'Edited title', description: 'edited', checkpointRef: null },
      ],
    })
    expect(actor.getSnapshot().context.tasks).toEqual([
      { id: 'o1-0', ord: 0, title: 'Edited title', description: 'edited', checkpointRef: null },
    ])
    expect(recordPlan).toHaveBeenCalledTimes(1)
  })

  it('REVISE from awaitingPlanApproval re-plans instead of being refused', () => {
    const actor = toAwaitingPlanApproval()
    actor.send({ type: 'REVISE', instruction: 'Split task one into two' })
    expect(actor.getSnapshot().value).toBe('planning')
    expect(actor.getSnapshot().context.reviseInstruction).toBe('Split task one into two')
    // The re-plan turn's own PLAN/TURN_FINISHED clears it once consumed, the
    // same way `revising`'s post-execution turn does.
    actor.send({ type: 'PLAN', event: planEvent })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('awaitingPlanApproval')
    expect(actor.getSnapshot().context.reviseInstruction).toBeNull()
  })

  it('REVISE from awaitingDecision re-proposes instead of being refused', () => {
    const actor = start()
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('awaitingDecision')
    actor.send({ type: 'REVISE', instruction: 'Consider a third option' })
    expect(actor.getSnapshot().value).toBe('proposing')
    expect(actor.getSnapshot().context.reviseInstruction).toBe('Consider a third option')
    // The re-propose turn's own DECISION_NEEDED/TURN_FINISHED clears it once
    // consumed, the same way `planning`'s re-plan turn does.
    actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('awaitingDecision')
    expect(actor.getSnapshot().context.reviseInstruction).toBeNull()
  })

  it('executing → verifying, and verifying → awaitingReview only on a green set', () => {
    const actor = toAwaitingPlanApproval()
    actor.send({ type: 'APPROVE_PLAN' })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('verifying')
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'pass', taskId: null }],
    })
    expect(actor.getSnapshot().value).toBe('awaitingReview')
  })

  it('a red evidence set pauses instead of reaching awaitingReview', () => {
    const actor = toAwaitingPlanApproval()
    actor.send({ type: 'APPROVE_PLAN' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'fail', taskId: null }],
    })
    expect(actor.getSnapshot().value).toBe('paused')
  })

  it('A11: a task-declared expectFailing lets a matching red set reach awaitingReview', () => {
    const actor = toAwaitingPlanApprovalWithExpectFailing()
    actor.send({ type: 'APPROVE_PLAN' })
    actor.send({ type: 'TURN_FINISHED' }) // execute-task settles -> verifying
    actor.send({ type: 'TURN_FINISHED' }) // the collector's invoked actor
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'fail', taskId: null }],
    })
    expect(actor.getSnapshot().value).toBe('awaitingReview')
  })

  it('A11: a red set NOT covered by expectFailing still pauses', () => {
    const actor = toAwaitingPlanApprovalWithExpectFailing()
    actor.send({ type: 'APPROVE_PLAN' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({
      // Task 0 only declared "test"; a "lint" failure (not in this spec, so
      // treat it as an unexpected extra required item is out of scope here —
      // simulate the same declared id failing for a DIFFERENT reason is not
      // representable, so instead prove the *second* task, which declared
      // nothing, still pauses on the same shape of red set.
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'fail', taskId: null }],
    })
    actor.send({ type: 'APPROVE_TASK' }) // advance to task 1, "Fix it" — no exemption
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'fail', taskId: null }],
    })
    expect(actor.getSnapshot().value).toBe('paused')
  })

  it('A11: a last task carrying expectFailing still cannot reach done — INTEGRATE stays strict', () => {
    // A one-task plan whose only task declares expectFailing, to force the
    // degenerate "exemption on the final task" shape the design doc's §3.2
    // names explicitly.
    const actor = start()
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
    actor.send({
      type: 'PLAN',
      event: {
        type: 'plan',
        tasks: [{ title: 'Only task', description: 'x', expectFailing: ['test'] }],
      },
    })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'APPROVE_PLAN' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'fail', taskId: null }],
    })
    expect(actor.getSnapshot().value).toBe('awaitingReview') // the per-task guard tolerated it

    actor.send({ type: 'APPROVE_TASK' }) // last task -> integrating directly
    expect(actor.getSnapshot().value).toBe('integrating')

    actor.send({ type: 'INTEGRATE', action: 'commit' })
    // The strict, unexempted re-check refuses: falls to paused, never done.
    expect(actor.getSnapshot().value).toBe('paused')
  })

  it('awaitingReview → executing for the next task, then integrating on the last', () => {
    const actor = toAwaitingReview()
    actor.send({ type: 'APPROVE_TASK' })
    expect(actor.getSnapshot().value).toBe('executing')
    expect(actor.getSnapshot().context.currentTaskIndex).toBe(1)
    expect(checkpoint).toHaveBeenCalledTimes(2)
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'pass', taskId: null }],
    })
    actor.send({ type: 'APPROVE_TASK' })
    expect(actor.getSnapshot().value).toBe('integrating')
  })

  it('A11-followup: markTaskVerified fires for the task being left, before currentTaskIndex advances', () => {
    const actor = toAwaitingReview()
    expect(actor.getSnapshot().context.currentTaskIndex).toBe(0)

    actor.send({ type: 'APPROVE_TASK' })

    expect(markTaskVerified).toHaveBeenCalledTimes(1)
    // The action ran while currentTaskIndex was still 0 (the task being left),
    // not 1 (the task being entered) -- this is the ordering the design doc's
    // §4 explicitly calls out as safety-critical.
    const call = markTaskVerified.mock.calls[0]
    expect(call).toBeDefined()
    expect(call?.[0].context.currentTaskIndex).toBe(0)
    expect(actor.getSnapshot().context.currentTaskIndex).toBe(1)
  })

  it('A11-followup: markTaskVerified does NOT fire on the last task (routes straight to integrating)', () => {
    const actor = toAwaitingReview()
    actor.send({ type: 'APPROVE_TASK' }) // task 0 -> task 1, into executing
    markTaskVerified.mockClear()

    // executing -> verifying -> awaitingReview, same cycle as the preceding
    // 'awaitingReview → executing for the next task...' test.
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'pass', taskId: null }],
    })
    actor.send({ type: 'APPROVE_TASK' }) // task 1, the last one -> integrating

    expect(actor.getSnapshot().value).toBe('integrating')
    expect(markTaskVerified).not.toHaveBeenCalled()
  })
})

describe('fast fix', () => {
  it('routes exploring straight to planning, skipping proposing', () => {
    const actor = start('fastfix')
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('planning')
  })

  it('still requires plan approval — auto-approval is M2', () => {
    const actor = start('fastfix')
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'PLAN', event: planEvent })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('awaitingPlanApproval')
  })
})

describe('investigation mode', () => {
  it('sends execute-task-investigation instead of execute-task when entering executing', () => {
    const actor = start('investigation')
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
    actor.send({ type: 'PLAN', event: planEvent })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'APPROVE_PLAN' })
    expect(actor.getSnapshot().value).toBe('executing')
    const lastCall = sendPrompt.mock.calls.at(-1)
    expect(lastCall?.[1]).toEqual({ phase: 'execute-task-investigation' })
  })

  it('visits the exact same state sequence as standard mode — no states skipped or added', () => {
    const seen: string[] = []
    const actor = start('investigation')
    // `start()` already called `actor.start()`, so the initial `idle`
    // notification predates this `subscribe` and is never delivered — xstate
    // v5's `subscribe` does not replay the current snapshot to a new
    // observer. `DECISION_NEEDED` and `PLAN` are internal transitions
    // (no `target`) whose `noteTurnEvent` action still runs `assign`, so
    // each produces its own same-value notification alongside the one from
    // the preceding `TURN_FINISHED` target change — this is unrelated to
    // `mode` and would be identical under `start('standard')`.
    actor.subscribe((snap) => seen.push(String(snap.value)))
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
    actor.send({ type: 'PLAN', event: planEvent })
    actor.send({ type: 'TURN_FINISHED' })
    expect(seen).toEqual([
      'exploring',
      'proposing',
      'proposing',
      'awaitingDecision',
      'planning',
      'planning',
      'awaitingPlanApproval',
    ])
  })
})

describe('the escapes', () => {
  it('PAUSE remembers where it came from and RESUME returns there', () => {
    const actor = start()
    actor.send({ type: 'START' })
    actor.send({ type: 'PAUSE' })
    expect(actor.getSnapshot().value).toBe('paused')
    expect(actor.getSnapshot().context.resumeState).toBe('exploring')
    actor.send({ type: 'RESUME' })
    expect(actor.getSnapshot().value).toBe('exploring')
  })

  it('CANCEL is terminal from anywhere', () => {
    const actor = start()
    actor.send({ type: 'START' })
    actor.send({ type: 'CANCEL' })
    expect(actor.getSnapshot().value).toBe('cancelled')
    expect(actor.getSnapshot().status).toBe('done')
  })

  it('a turn that times out pauses the objective, never fails it', () => {
    const actor = toAwaitingPlanApproval()
    actor.send({ type: 'APPROVE_PLAN' })
    actor.send({ type: 'TURN_FAILED', reason: 'timeout', message: 'no response in 20m' })
    expect(actor.getSnapshot().value).toBe('paused')
    expect(actor.getSnapshot().context.lastFailure?.headline).toContain('timeout')
  })

  it('paused accepts ROLLBACK, which resets and retries the same task', () => {
    const actor = toAwaitingPlanApproval()
    actor.send({ type: 'APPROVE_PLAN' })
    actor.send({ type: 'TURN_FAILED', reason: 'agent_crash', message: 'adapter exited' })
    actor.send({ type: 'ROLLBACK' })
    expect(rollbackToCheckpoint).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().value).toBe('executing')
    expect(actor.getSnapshot().context.currentTaskIndex).toBe(0)
  })

  it('paused accepts REVISE, which re-prompts and re-verifies', () => {
    const actor = toAwaitingReview()
    actor.send({ type: 'REVISE', instruction: 'also handle the null case' })
    expect(actor.getSnapshot().value).toBe('revising')
    expect(actor.getSnapshot().context.reviseInstruction).toBe('also handle the null case')
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('verifying')
  })
})

describe('verifying invokes the collector (phase 4)', () => {
  it('invokes runVerification and stores its runId', async () => {
    const actor = startVerifying({ output: { runId: 'run-1' } })
    await settle()
    expect(actor.getSnapshot().context.verificationRunId).toBe('run-1')
  })

  it('with no checks, reconciles without prompting the agent', async () => {
    const sent: string[] = []
    startVerifying({ output: { runId: 'run-1' }, checks: [], sent })
    await settle()
    expect(sent).toEqual(['reconcile'])
  })

  it('with checks, prompts the agent and reconciles when the turn finishes', async () => {
    const sent: string[] = []
    const actor = startVerifying({
      output: { runId: 'run-1' },
      checks: ['Bug reproduced'],
      sent,
    })
    await settle()
    expect(sent).toEqual(['verify'])

    actor.send({ type: 'TURN_FINISHED' })
    expect(sent).toEqual(['verify', 'reconcile'])
    expect(actor.getSnapshot().value).toBe('verifying')
  })

  it('a collector failure pauses rather than pretending the set is red', async () => {
    const actor = startVerifying({
      failWith: new Error('bad cwd'),
    })
    await settle()
    expect(actor.getSnapshot().value).toBe('paused')
    expect(actor.getSnapshot().context.lastFailure?.headline).toContain('Verification')
  })

  it('EVIDENCE_RESULT still routes on the guard, unchanged', async () => {
    const actor = startVerifying({ output: { runId: 'r' } })
    await settle()
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'pass', taskId: null }],
    })
    expect(actor.getSnapshot().value).toBe('awaitingReview')
  })

  it('executing entry stamps a fresh verificationEpoch and clears the runId', async () => {
    const actor = startVerifying({ output: { runId: 'run-1' } })
    await settle()
    expect(actor.getSnapshot().context.verificationRunId).toBe('run-1')
    const firstEpoch = actor.getSnapshot().context.verificationEpoch
    expect(firstEpoch).toBeTruthy()

    // A green set, approved, moves on to task 1 — a fresh `executing` entry.
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'pass', taskId: null }],
    })
    actor.send({ type: 'APPROVE_TASK' })
    expect(actor.getSnapshot().value).toBe('executing')
    // New work invalidates the previous verification generation.
    expect(actor.getSnapshot().context.verificationRunId).toBeNull()
    expect(actor.getSnapshot().context.verificationEpoch).not.toBeNull()
  })
})

// --- helpers, defined last so the tests above read top-down ---

/**
 * Drives a purpose-built actor to `verifying`, with the collector actor and
 * the two prompt/reconcile actions replaced by recorders.
 *
 * `start()` above cannot serve: these tests vary the spec's `checks` (which
 * `hasChecks` reads) and need the invoked actor's outcome under their control.
 */
function startVerifying(opts: {
  output?: { runId: string }
  failWith?: Error
  checks?: string[]
  sent?: string[]
}) {
  const sent = opts.sent
  const machine = workflowMachine.provide({
    actors: {
      runVerification: fromPromise<
        { runId: string; taskRisk: 'low' | 'high' },
        { objectiveId: string; taskId: string | null }
      >(async () => {
        if (opts.failWith) throw opts.failWith
        return { ...(opts.output ?? { runId: 'run-stub' }), taskRisk: 'high' }
      }),
    },
    actions: {
      checkpoint,
      sendPrompt: (_, params: { phase: string }) => {
        if (params.phase === 'verify') sent?.push('verify')
      },
      reconcileEvidence: () => sent?.push('reconcile'),
    },
  })
  const actor = createActor(machine, {
    input: initialContext({
      objectiveId: 'o1',
      goalText: 'fix the bug',
      mode: 'standard',
      lowEnergy: false,
      verificationSpec: VerificationSpec.parse({
        verify: {
          commands: [{ id: 'test', run: 'pnpm test', required: true }],
          checks: opts.checks ?? [],
        },
      }),
    }),
  })
  actor.start()
  actor.send({ type: 'START' })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
  actor.send({ type: 'PLAN', event: planEvent })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'APPROVE_PLAN' })
  actor.send({ type: 'TURN_FINISHED' })
  return actor
}

/** Lets the invoked promise settle and xstate process its onDone/onError. */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

function toAwaitingPlanApproval() {
  const actor = start()
  actor.send({ type: 'START' })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
  actor.send({ type: 'PLAN', event: planEvent })
  actor.send({ type: 'TURN_FINISHED' })
  return actor
}

function toAwaitingPlanApprovalWithExpectFailing() {
  const actor = start()
  actor.send({ type: 'START' })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
  actor.send({ type: 'PLAN', event: planEventWithExpectFailing })
  actor.send({ type: 'TURN_FINISHED' })
  return actor
}

function toAwaitingReview() {
  const actor = toAwaitingPlanApproval()
  actor.send({ type: 'APPROVE_PLAN' })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({
    type: 'EVIDENCE_RESULT',
    items: [{ commandId: 'test', kind: 'test', status: 'pass', taskId: null }],
  })
  return actor
}

function startWithLowEnergy(taskRisk: 'low' | 'high') {
  const machine = workflowMachine.provide({
    actions: {
      sendPrompt,
      checkpoint,
      rollbackToCheckpoint,
      recordPlan,
      markTaskVerified,
      noteAutoApprovedTask,
      noteAutoApprovedPlan,
    },
    actors: { runVerification: fromPromise(async () => ({ runId: 'run-stub', taskRisk })) },
  })
  const actor = createActor(machine, {
    input: initialContext({
      objectiveId: 'o1',
      goalText: 'fix the bug',
      mode: 'standard',
      lowEnergy: true,
      verificationSpec: spec,
    }),
  })
  actor.start()
  return actor
}

const oneTaskPlanEvent = {
  type: 'plan',
  tasks: [{ title: 'Fix it', description: 'patch' }],
} satisfies Extract<WorkflowEvent, { type: 'PLAN' }>['event']

/**
 * A single-task plan, deliberately not the shared two-task `planEvent`: this
 * drives to `awaitingReview` for what is *also* the plan's last task, so a
 * `'low'` risk auto-approval lands on `integrating`, not `executing` — the
 * interesting new behavior here is whether the raise fires at all, and
 * `APPROVE_TASK`'s own `hasMoreTasks` branch is already covered by pre-existing
 * tests exercising it manually.
 */
async function toAwaitingReviewWithRisk(taskRisk: 'low' | 'high') {
  const actor = startWithLowEnergy(taskRisk)
  actor.send({ type: 'START' })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
  actor.send({ type: 'PLAN', event: oneTaskPlanEvent })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'APPROVE_PLAN' })
  actor.send({ type: 'TURN_FINISHED' })
  actor.send({ type: 'TURN_FINISHED' })
  await settle()
  actor.send({
    type: 'EVIDENCE_RESULT',
    items: [{ commandId: 'test', kind: 'test', status: 'pass', taskId: null }],
  })
  return actor
}

const twoTaskFastFixPlanEvent = {
  type: 'plan',
  tasks: [
    { title: 'One', description: 'first' },
    { title: 'Two', description: 'second' },
  ],
} satisfies Extract<WorkflowEvent, { type: 'PLAN' }>['event']

describe('amendment A12: auto-approval', () => {
  it('lowEnergy + low risk skips awaitingReview, landing on integrating for the last task', async () => {
    const actor = await toAwaitingReviewWithRisk('low')
    expect(actor.getSnapshot().value).toBe('integrating')
    expect(noteAutoApprovedTask).toHaveBeenCalledTimes(1)
  })

  it('lowEnergy + high risk stays at awaitingReview', async () => {
    const actor = await toAwaitingReviewWithRisk('high')
    expect(actor.getSnapshot().value).toBe('awaitingReview')
    expect(noteAutoApprovedTask).not.toHaveBeenCalled()
  })

  it('low risk with lowEnergy off stays at awaitingReview', async () => {
    const machine = workflowMachine.provide({
      actions: {
        sendPrompt,
        checkpoint,
        rollbackToCheckpoint,
        recordPlan,
        markTaskVerified,
        noteAutoApprovedTask,
      },
      actors: {
        runVerification: fromPromise<
          { runId: string; taskRisk: 'low' | 'high' },
          { objectiveId: string; taskId: string | null }
        >(async () => ({ runId: 'run-stub', taskRisk: 'low' })),
      },
    })
    const actor = createActor(machine, {
      input: initialContext({
        objectiveId: 'o1',
        goalText: 'fix the bug',
        mode: 'standard',
        lowEnergy: false,
        verificationSpec: spec,
      }),
    })
    actor.start()
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
    actor.send({ type: 'PLAN', event: oneTaskPlanEvent })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'APPROVE_PLAN' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'TURN_FINISHED' })
    await settle()
    actor.send({
      type: 'EVIDENCE_RESULT',
      items: [{ commandId: 'test', kind: 'test', status: 'pass', taskId: null }],
    })
    expect(actor.getSnapshot().value).toBe('awaitingReview')
  })

  it('integrating still requires evidenceComplete on its own re-check — auto-approval never bypasses it', async () => {
    // The last task's own evidence was green (how it got to integrating at
    // all); this pins that `integrating`'s `INTEGRATE` guard is untouched by
    // this task, not that auto-approval could ever reach `done` on red — that
    // guard is `evidenceComplete`, unchanged since amendment A11.
    const actor = await toAwaitingReviewWithRisk('low')
    expect(actor.getSnapshot().value).toBe('integrating')
    actor.send({ type: 'INTEGRATE', action: 'keep' })
    expect(actor.getSnapshot().value).toBe('done')
  })

  it('a Fast Fix single-task plan auto-approves at awaitingPlanApproval', () => {
    const machine = workflowMachine.provide({
      actions: { sendPrompt, checkpoint, recordPlan, noteAutoApprovedPlan },
    })
    const actor = createActor(machine, {
      input: initialContext({
        objectiveId: 'o1',
        goalText: 'fix the bug',
        mode: 'fastfix',
        lowEnergy: false,
        verificationSpec: spec,
      }),
    })
    actor.start()
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'PLAN', event: oneTaskPlanEvent })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('executing')
    expect(noteAutoApprovedPlan).toHaveBeenCalledTimes(1)
  })

  it('a Fast Fix multi-task plan does not auto-approve', () => {
    const machine = workflowMachine.provide({
      actions: { sendPrompt, checkpoint, recordPlan, noteAutoApprovedPlan },
    })
    const actor = createActor(machine, {
      input: initialContext({
        objectiveId: 'o1',
        goalText: 'fix the bug',
        mode: 'fastfix',
        lowEnergy: false,
        verificationSpec: spec,
      }),
    })
    actor.start()
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'PLAN', event: twoTaskFastFixPlanEvent })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().value).toBe('awaitingPlanApproval')
    expect(noteAutoApprovedPlan).not.toHaveBeenCalled()
  })

  it('a standard-mode plan does not auto-approve regardless of task count — Fast Fix only', () => {
    const actor = toAwaitingPlanApproval()
    expect(actor.getSnapshot().value).toBe('awaitingPlanApproval')
  })
})

describe('SET_LOW_ENERGY', () => {
  it('is a context-only assign from any state, not a transition', () => {
    const actor = start()
    actor.send({ type: 'START' })
    expect(actor.getSnapshot().value).toBe('exploring')
    actor.send({ type: 'SET_LOW_ENERGY', value: true })
    expect(actor.getSnapshot().value).toBe('exploring')
    expect(actor.getSnapshot().context.lowEnergy).toBe(true)
  })
})

describe('amendment A12: taskRisk', () => {
  it('is assigned from the invoked collector actor before awaitingReview is entered', () => {
    const machine = workflowMachine.provide({
      actions: { sendPrompt, checkpoint, rollbackToCheckpoint, recordPlan, markTaskVerified },
      actors: {
        runVerification: fromPromise<
          { runId: string; taskRisk: 'low' | 'high' },
          { objectiveId: string; taskId: string | null }
        >(async () => ({ runId: 'run-stub', taskRisk: 'low' })),
      },
    })
    const actor = createActor(machine, {
      input: initialContext({
        objectiveId: 'o1',
        goalText: 'fix the bug',
        mode: 'standard',
        lowEnergy: false,
        verificationSpec: spec,
      }),
    })
    actor.start()
    actor.send({ type: 'START' })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECISION_NEEDED', event: decisionEvent })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'DECIDE', decisionId: 'd1', optionId: 'a' })
    actor.send({ type: 'PLAN', event: planEvent })
    actor.send({ type: 'TURN_FINISHED' })
    actor.send({ type: 'APPROVE_PLAN' })
    actor.send({ type: 'TURN_FINISHED' })
    expect(actor.getSnapshot().context.taskRisk).toBeNull()
    return settle().then(() => {
      expect(actor.getSnapshot().context.taskRisk).toBe('low')
    })
  })
})
