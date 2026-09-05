import type { ViewStateName } from './primary.js'

/**
 * Level 1 words for a machine state — what the user has to do, or what is
 * happening, instead of `awaitingPlanApproval`.
 *
 * Total over `ViewStateName` with the same `never` guard as `primary.ts` and
 * `stateColor.ts`: a new machine state is a type error here, not a screen
 * showing its camelCase name.
 */
export function stateLabel(state: ViewStateName): string {
  switch (state) {
    case 'idle':
      return 'Not started'
    case 'creating':
      return 'Setting up the worktree'
    case 'exploring':
      return 'Exploring the codebase'
    case 'clarifying':
      return 'Waiting for your answer'
    case 'proposing':
      return 'Proposing options'
    case 'awaitingDecision':
      return 'Waiting for your decision'
    case 'planning':
      return 'Planning'
    case 'awaitingPlanApproval':
      return 'Waiting for plan approval'
    case 'executing':
      return 'Executing'
    case 'verifying':
      return 'Verifying'
    case 'awaitingReview':
      return 'Ready for your review'
    case 'revising':
      return 'Revising'
    case 'rollingBack':
      return 'Rolling back'
    case 'integrating':
      return 'Integrating'
    case 'done':
      return 'Done'
    case 'paused':
      return 'Paused'
    case 'cancelled':
      return 'Abandoned'
    case 'failed':
      return 'Failed'
    case 'setup_failed':
      return 'Setup failed'
    default: {
      const unhandled: never = state
      throw new Error(`No label for state: ${String(unhandled)}`)
    }
  }
}
