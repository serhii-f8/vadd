import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import type { WorkflowEvent } from '../src/machine/types.js'
import { MACHINE_STATES } from '../src/machine/types.js'
import { initialContext, workflowMachine } from '../src/machine/workflow-machine.js'
import { VerificationSpec } from '../src/schemas/verification.js'

const spec = VerificationSpec.parse({
  verify: {
    commands: [
      { id: 'test', run: 'pnpm test', required: true },
      { id: 'lint', run: 'pnpm lint', required: true },
    ],
    checks: ['Repro test exists'],
  },
})

/** Every event shape the machine accepts, with an incomplete evidence set. */
const EVERY_EVENT: WorkflowEvent[] = [
  { type: 'START' },
  { type: 'STATUS', event: { type: 'status', phase: 'exploring', headline: 'h' } },
  {
    type: 'DECISION_NEEDED',
    event: {
      type: 'decision_needed',
      question: 'q',
      options: [
        { id: 'a', label: 'A', pros: [], cons: [], reversibility: 'high', verification: 'v' },
        { id: 'b', label: 'B', pros: [], cons: [], reversibility: 'low', verification: 'v' },
      ],
      recommendedId: 'a',
    },
  },
  { type: 'CLARIFICATION', event: { type: 'clarification', question: 'q', suggestedAnswers: [] } },
  {
    type: 'PLAN',
    event: { type: 'plan', tasks: [{ title: 't', description: 'd' }] },
  },
  {
    type: 'TASK_RESULT',
    event: { type: 'task_result', taskId: '0', claim: 'done', evidenceRefs: [] },
  },
  {
    type: 'EVIDENCE',
    event: { type: 'evidence', kind: 'test', status: 'pass', headline: 'h', summary: [] },
  },
  {
    type: 'FAILURE',
    event: { type: 'failure', headline: 'h', probableCause: 'c', suggestedActions: [] },
  },
  { type: 'TURN_FINISHED' },
  { type: 'TURN_FAILED', reason: 'timeout', message: 'm' },
  { type: 'DECIDE', decisionId: 'd', optionId: 'a' },
  { type: 'ANSWER_CLARIFICATION', answer: 'a' },
  { type: 'APPROVE_PLAN' },
  { type: 'APPROVE_TASK' },
  { type: 'REVISE', instruction: 'i' },
  { type: 'ROLLBACK' },
  { type: 'PAUSE' },
  { type: 'RESUME' },
  { type: 'INTEGRATE', action: 'commit' },
  // Deliberately NOT { type: 'CANCEL' } — it is terminal and would end every
  // walk after one step, collapsing the search space to nothing.
]

/** Evidence sets that are all short of green in at least one way. */
const INCOMPLETE_SETS: WorkflowEvent[] = [
  { type: 'EVIDENCE_RESULT', items: [] },
  {
    type: 'EVIDENCE_RESULT',
    items: [{ commandId: 'test', kind: 'test', status: 'pass', taskId: null }],
  },
  {
    type: 'EVIDENCE_RESULT',
    items: [
      { commandId: 'test', kind: 'test', status: 'pass', taskId: null },
      { commandId: 'lint', kind: 'lint', status: 'fail', taskId: null },
      { commandId: 'check-0', kind: 'check', status: 'pass', taskId: null },
    ],
  },
  {
    type: 'EVIDENCE_RESULT',
    items: [
      // `warn` without allowWarn on the command.
      { commandId: 'test', kind: 'test', status: 'warn', taskId: null },
      { commandId: 'lint', kind: 'lint', status: 'pass', taskId: null },
      { commandId: 'check-0', kind: 'check', status: 'pass', taskId: null },
    ],
  },
  {
    type: 'EVIDENCE_RESULT',
    items: [
      // Every command green, the check missing.
      { commandId: 'test', kind: 'test', status: 'pass', taskId: null },
      { commandId: 'lint', kind: 'lint', status: 'pass', taskId: null },
    ],
  },
  {
    type: 'EVIDENCE_RESULT',
    // Agent-emitted evidence, no commandId — must not close anything.
    items: [{ commandId: null, kind: 'test', status: 'pass', taskId: null }],
  },
]

function fresh() {
  const actor = createActor(
    workflowMachine.provide({
      actions: {
        sendPrompt: () => {},
        checkpoint: () => {},
        rollbackToCheckpoint: () => {},
        recordDecision: () => {},
        recordPlan: () => {},
        recordEvidence: () => {},
        finishObjective: () => {},
      },
    }),
    {
      input: initialContext({
        objectiveId: 'o',
        goalText: 'g',
        mode: 'standard',
        lowEnergy: false,
        verificationSpec: spec,
      }),
    },
  )
  actor.start()
  return actor
}

describe('spec §5: `done` is unreachable without a full green evidence set', () => {
  it('covers every declared state name', () => {
    // A state added to the machine but not to MACHINE_STATES would silently
    // escape this whole file.
    const declared = new Set<string>(MACHINE_STATES)
    const inMachine = Object.keys(workflowMachine.config.states ?? {})
    expect(new Set(inMachine)).toEqual(declared)
  })

  it('reaches `done` from no walk in which the evidence set is incomplete', () => {
    const alphabet = [...EVERY_EVENT, ...INCOMPLETE_SETS]
    const seen = new Set<string>()
    let walks = 0

    // Breadth-first over (state, sent-events) pairs, replaying from the start
    // for each walk so no walk inherits another's context. Depth 6 covers the
    // longest legal path to `integrating` (START → TURN_FINISHED → DECIDE →
    // TURN_FINISHED → APPROVE_PLAN → …) with room to spare.
    const frontier: WorkflowEvent[][] = [[]]
    for (let depth = 0; depth < 6; depth++) {
      const next: WorkflowEvent[][] = []
      for (const prefix of frontier) {
        for (const event of alphabet) {
          const walk = [...prefix, event]
          const actor = fresh()
          for (const e of walk) actor.send(e)
          const snap = actor.getSnapshot()
          walks++
          expect(snap.value, `reached done via ${walk.map((e) => e.type).join(' → ')}`).not.toBe(
            'done',
          )
          const key = `${String(snap.value)}|${walk.length}`
          if (!seen.has(key)) {
            seen.add(key)
            next.push(walk)
          }
        }
      }
      frontier.length = 0
      frontier.push(...next)
    }

    // A guard against the walk silently collapsing — if a machine change made
    // every event a no-op, the assertion above would pass vacuously.
    expect(walks).toBeGreaterThan(500)
    expect(seen.size).toBeGreaterThan(10)
  })

  it('reaches `done` when — and only when — the set is green at the moment of INTEGRATE', () => {
    const actor = toIntegrating(GREEN_SET)
    expect(actor.getSnapshot().value).toBe('integrating')
    actor.send({ type: 'INTEGRATE', action: 'commit' })
    expect(actor.getSnapshot().value).toBe('done')
  })

  it('refuses INTEGRATE when the evidence went red after review', () => {
    // The guard is re-read at INTEGRATE rather than trusted from `verifying`
    // (design §6.4). Reaching `integrating` on a green set and then losing it
    // is the only way to test that distinction — every other walk fails the
    // guard in `verifying` first and never gets here.
    const actor = toIntegrating(GREEN_SET)
    actor.send({ type: 'EVIDENCE_RESULT', items: [] })
    expect(actor.getSnapshot().value).toBe('integrating')
    actor.send({ type: 'INTEGRATE', action: 'commit' })
    expect(actor.getSnapshot().value).not.toBe('done')
  })
})

const GREEN_SET: WorkflowEvent = {
  type: 'EVIDENCE_RESULT',
  items: [
    { commandId: 'test', kind: 'test', status: 'pass', taskId: null },
    { commandId: 'lint', kind: 'lint', status: 'pass', taskId: null },
    { commandId: 'check-0', kind: 'check', status: 'pass', taskId: null },
  ],
}

/** The shortest legal walk to `integrating`, on a one-task plan. */
function toIntegrating(evidenceSet: WorkflowEvent) {
  const actor = fresh()
  const walk: WorkflowEvent[] = [
    { type: 'START' },
    { type: 'TURN_FINISHED' },
    {
      type: 'DECISION_NEEDED',
      event: {
        type: 'decision_needed',
        question: 'q',
        options: [
          { id: 'a', label: 'A', pros: [], cons: [], reversibility: 'high', verification: 'v' },
          { id: 'b', label: 'B', pros: [], cons: [], reversibility: 'low', verification: 'v' },
        ],
        recommendedId: 'a',
      },
    },
    { type: 'TURN_FINISHED' },
    { type: 'DECIDE', decisionId: 'd', optionId: 'a' },
    { type: 'PLAN', event: { type: 'plan', tasks: [{ title: 't', description: 'd' }] } },
    { type: 'TURN_FINISHED' },
    { type: 'APPROVE_PLAN' },
    { type: 'TURN_FINISHED' },
    { type: 'TURN_FINISHED' },
    evidenceSet,
    { type: 'APPROVE_TASK' },
  ]
  for (const e of walk) actor.send(e)
  return actor
}
