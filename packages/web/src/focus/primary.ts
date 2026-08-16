import type { MachineStateName } from '@vadd/core'

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

/**
 * Total over `MACHINE_STATES`. Written as an exhaustive switch rather than a
 * record so that adding a state to the machine is a **type error here**, not a
 * blank Focus View discovered by a user — the machine is the source of truth
 * for what can happen, and this file has to keep up with it.
 */
export function primaryElementFor(state: MachineStateName): PrimaryElement {
  switch (state) {
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
      // Unreachable while the switch is exhaustive. If a new machine state is
      // added, `never` stops compiling here and names the omission.
      const unhandled: never = state
      throw new Error(`No primary element for machine state: ${String(unhandled)}`)
    }
  }
}
