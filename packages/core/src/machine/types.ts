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
}

/**
 * The subset of an `evidence_items` row the guard reads. Deliberately not the
 * Drizzle row type: `core` must not import from `server`.
 */
export type EvidenceItemLike = {
  commandId: string | null
  kind: 'test' | 'diff' | 'lint' | 'build' | 'check' | 'artifact' | 'warning'
  status: 'pass' | 'fail' | 'warn' | 'info'
  taskId: string | null
}

export type WorkflowContext = {
  objectiveId: string
  mode: 'standard' | 'fastfix'
  lowEnergy: boolean
  goalText: string
  verificationSpec: VerificationSpec | null
  tasks: PlanTaskLike[]
  currentTaskIndex: number
  evidence: EvidenceItemLike[]
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
 */
export function toMachineEvent(event: AgentEvent): WorkflowEvent {
  return { type: AGENT_EVENT_TO_MACHINE[event.type], event } as WorkflowEvent
}
