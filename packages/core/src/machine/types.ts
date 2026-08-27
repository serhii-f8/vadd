import type { AgentEvent } from '../schemas/agent-event.js'
import type { VerificationSpec } from '../schemas/verification.js'

/** Spec §5 verbatim. Order is the happy path, then the three escapes. */
export const MACHINE_STATES = [
  'idle',
  'exploring',
  'clarifying',
  'proposing',
  'awaitingDecision',
  'planning',
  'awaitingPlanApproval',
  'executing',
  'verifying',
  'awaitingReview',
  'revising',
  'rollingBack',
  'integrating',
  'done',
  'paused',
  'cancelled',
  'failed',
] as const
export type MachineStateName = (typeof MACHINE_STATES)[number]

/** No objective leaves these three. */
export const TERMINAL_STATES = ['done', 'cancelled', 'failed'] as const

export type PlanTaskLike = {
  id: string
  ord: number
  title: string
  description: string
  checkpointRef: string | null
  /** Amendment A11. Optional — absent means no exemption, same as an empty array. */
  expectFailing?: string[]
}

/**
 * A plan task's identity, and the reason it is not just its position.
 *
 * `plan_tasks.id` is a single-column primary key, and until phase 6 the machine
 * filled it with the task's ordinal — `'0'`, `'1'`, `'2'`. That is unique
 * within one objective and globally unique nowhere, so the *second* objective
 * in any database that ever reached `planning` failed its `recordPlan` insert
 * with `UNIQUE constraint failed: plan_tasks.id` and went on to
 * `awaitingPlanApproval` with no rows behind it. Scoping the id by objective is
 * what makes the ordinal meaningful again.
 *
 * Chosen over a composite `(objective_id, ord)` primary key because
 * `evidence_items.task_id` is a single-column foreign key onto this one:
 * a composite key would have to be mirrored into that table (and into every
 * join through it) to buy exactly the same uniqueness this buys for free.
 */
export function planTaskId(objectiveId: string, ord: number): string {
  return `${objectiveId}:${ord}`
}

/**
 * The subset of an `evidence_items` row the guard reads. Deliberately not the
 * Drizzle row type: `core` must not import from `server`.
 */
export type EvidenceItemLike = {
  commandId: string | null
  kind: 'test' | 'diff' | 'lint' | 'build' | 'check' | 'artifact' | 'warning' | 'security'
  status: 'pass' | 'fail' | 'warn' | 'info'
  taskId: string | null
}

export type WorkflowContext = {
  objectiveId: string
  mode: 'standard' | 'fastfix' | 'investigation'
  lowEnergy: boolean
  goalText: string
  verificationSpec: VerificationSpec | null
  tasks: PlanTaskLike[]
  currentTaskIndex: number
  evidence: EvidenceItemLike[]
  /**
   * The EvidenceCollector run currently being reconciled. `reconcileEvidence`
   * scopes command rows to it: verification evidence must be freshly produced,
   * or a green run recorded before a ROLLBACK would satisfy the guard after a
   * later red one (design §5.4).
   */
  verificationRunId: string | null
  /**
   * ISO timestamp stamped on every `executing` entry. Check rows created at or
   * after it count; older ones do not. Check rows are deliberately *not* scoped
   * to a run — a user's manual tick must survive a re-verify, while commands
   * must be re-proven (design §5.4).
   */
  verificationEpoch: string | null
  /**
   * Amendment A12. Set from `runVerification`'s output when its `onDone`
   * fires, read only by `awaitingReview`'s auto-approve action. `null` until
   * the first verification completes, and reset to `null` on every fresh
   * `executing` entry so a stale classification from a prior task can never
   * leak into a new one's evaluation.
   */
  taskRisk: 'low' | 'high' | null
  /** `'plan'` and `` `task:${ord}` `` keys the user has explicitly approved. */
  approvals: string[]
  pendingDecisionId: string | null
  pendingClarification: string | null
  /**
   * Which `AgentEvent` types the *open turn* has produced.
   *
   * The machine advances on `TURN_FINISHED`, not on the first agent event: a
   * turn emits several `status` events before it is done, and advancing on the
   * first would leave the pipeline streaming into a state that had already
   * moved on. This is the same turn model the contract pipeline uses.
   */
  turnEvents: AgentEvent['type'][]
  lastFailure: { headline: string; probableCause: string } | null
  /** Where a `PAUSE` came from, so `RESUME` returns there. */
  resumeState: MachineStateName | null
  reviseInstruction: string | null
}

export type WorkflowEvent =
  // --- from the contract pipeline (validated AgentEvents only) ---
  | { type: 'STATUS'; event: Extract<AgentEvent, { type: 'status' }> }
  | { type: 'DECISION_NEEDED'; event: Extract<AgentEvent, { type: 'decision_needed' }> }
  | { type: 'CLARIFICATION'; event: Extract<AgentEvent, { type: 'clarification' }> }
  | { type: 'PLAN'; event: Extract<AgentEvent, { type: 'plan' }> }
  | { type: 'TASK_RESULT'; event: Extract<AgentEvent, { type: 'task_result' }> }
  | { type: 'EVIDENCE'; event: Extract<AgentEvent, { type: 'evidence' }> }
  | { type: 'FAILURE'; event: Extract<AgentEvent, { type: 'failure' }> }
  // --- from the runner, when a turn's prompt settles and endTurn has run ---
  | { type: 'TURN_FINISHED' }
  | { type: 'TURN_FAILED'; reason: 'timeout' | 'agent_crash' | 'error'; message: string }
  // --- from EvidenceCollector (phase 4); synthesised by the runner until then ---
  | { type: 'EVIDENCE_RESULT'; items: EvidenceItemLike[] }
  // --- user commands ---
  | { type: 'START' }
  | { type: 'DECIDE'; decisionId: string; optionId: string }
  | { type: 'ANSWER_CLARIFICATION'; answer: string }
  | { type: 'APPROVE_PLAN'; tasks?: PlanTaskLike[] }
  | { type: 'APPROVE_TASK' }
  | { type: 'REVISE'; instruction: string }
  | { type: 'ROLLBACK' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'CANCEL' }
  | { type: 'INTEGRATE'; action: 'commit' | 'keep' | 'discard' }
  /** Amendment A12. Context-only — no state-value change, so it fires no transition. */
  | { type: 'SET_LOW_ENERGY'; value: boolean }

const AGENT_EVENT_TO_MACHINE = {
  status: 'STATUS',
  decision_needed: 'DECISION_NEEDED',
  clarification: 'CLARIFICATION',
  plan: 'PLAN',
  task_result: 'TASK_RESULT',
  evidence: 'EVIDENCE',
  failure: 'FAILURE',
} as const

/**
 * The one translation from contract vocabulary to machine vocabulary.
 *
 * It lives in `core` beside the machine rather than in the runner so the
 * exhaustive transition test and the server agree on it by construction — a
 * mapping the server owned privately could drift from the states the test
 * enumerates without anything failing.
 *
 * The parameter type deliberately excludes `memory_note`: it is
 * project-scoped metadata, not a phase-transition signal, and has no entry
 * in `AGENT_EVENT_TO_MACHINE`. `WorkflowRunner.ingest` intercepts and
 * persists it before this function is ever called — narrowing the
 * parameter here makes that invariant a type error to violate, rather than
 * an unmapped lookup silently producing `{ type: undefined, event }`.
 */
export function toMachineEvent(event: Exclude<AgentEvent, { type: 'memory_note' }>): WorkflowEvent {
  return { type: AGENT_EVENT_TO_MACHINE[event.type], event } as WorkflowEvent
}
