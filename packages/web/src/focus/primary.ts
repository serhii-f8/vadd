import type { MachineStateName } from '@vadd/core'

/**
 * Every value `GET /api/objectives/:id` can put in `state`.
 *
 * Wider than `MachineStateName` on purpose: the endpoint falls back to the
 * `objectives.status` column when no actor is live, and that column carries two
 * statuses the machine never holds — `creating` (dependencies installing) and
 * `setup_failed` (a deliberately permanent row, because it owns the
 * `evidence_items` row with the failure log). Both are one click away from the
 * board, so the view has to be total over them too.
 */
export type ViewStateName = MachineStateName | 'creating' | 'setup_failed'

/**
 * The one primary element the Focus View shows for a given state — spec §8's
 * "exactly one primary element by state".
 */
export type PrimaryElement =
  /** A decision or clarification the user must answer. */
  | 'decision'
  /** The proposed plan, editable, awaiting approval. */
  | 'plan'
  /** The agent is working: phase, last headline, elapsed. No log stream. */
  | 'live'
  /** The evidence set plus approve / revise / rollback. */
  | 'review'
  /** commit / keep / discard. */
  | 'integration'
  /** Terminal: what happened, and the final evidence set, read-only. */
  | 'outcome'
  /** Nothing is in flight: start or resume, or abandon. */
  | 'resume'
  /** The worktree's dependencies are installing. Nothing to do yet. */
  | 'setup'

/**
 * Total over `ViewStateName`. Written as an exhaustive switch rather than a
 * record so that adding a state to the machine is a **type error here**, not a
 * blank Focus View discovered by a user — the machine is the source of truth
 * for what can happen, and this file has to keep up with it.
 */
export function primaryElementFor(state: ViewStateName): PrimaryElement {
  switch (state) {
    case 'creating':
      return 'setup'
    // The outcome element renders the evidence set read-only, and the setup
    // failure log is an `evidence_items` row — this is where it gets read.
    case 'setup_failed':
      return 'outcome'
    case 'awaitingDecision':
    case 'clarifying':
      return 'decision'
    case 'awaitingPlanApproval':
      return 'plan'
    case 'exploring':
    case 'proposing':
    case 'planning':
    case 'executing':
    case 'verifying':
    case 'revising':
    case 'rollingBack':
      return 'live'
    case 'awaitingReview':
      return 'review'
    case 'integrating':
      return 'integration'
    case 'done':
    case 'cancelled':
    case 'failed':
      return 'outcome'
    case 'idle':
    case 'paused':
      return 'resume'
    default: {
      // Unreachable while the switch is exhaustive. If a new machine state or
      // objective status is added, `never` stops compiling here and names it.
      const unhandled: never = state
      throw new Error(`No primary element for machine state: ${String(unhandled)}`)
    }
  }
}
