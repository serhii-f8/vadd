import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import type { WorkflowEvent } from '../src/machine/types.js'
import { initialContext, workflowMachine } from '../src/machine/workflow-machine.js'
import { VerificationSpec } from '../src/schemas/verification.js'

const spec = VerificationSpec.parse({
  verify: { commands: [{ id: 'test', run: 'pnpm test', required: true }] },
})

const sendPrompt = vi.fn()
const checkpoint = vi.fn()
const rollbackToCheckpoint = vi.fn()

const stubbed = workflowMachine.provide({
  actions: { sendPrompt, checkpoint, rollbackToCheckpoint },
})

function start(mode: 'standard' | 'fastfix' = 'standard') {
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

// --- helpers, defined last so the tests above read top-down ---

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
