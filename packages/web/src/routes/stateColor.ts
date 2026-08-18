import type { ViewStateName } from '../focus/primary.js'

/**
 * The 5-color semantic mapping, not the raw 18 machine states — the point is
 * scanning "what needs me" across many objectives without reading each state
 * word (M2 shadcn visual pass design doc §3).
 */
export function stateColor(state: ViewStateName): string {
  switch (state) {
    case 'idle':
    case 'creating':
      return 'bg-gray-400'
    case 'exploring':
    case 'proposing':
    case 'planning':
    case 'executing':
    case 'verifying':
    case 'revising':
    case 'rollingBack':
    case 'integrating':
      return 'bg-blue-500'
    case 'awaitingDecision':
    case 'clarifying':
    case 'awaitingPlanApproval':
    case 'awaitingReview':
    case 'paused':
      return 'bg-amber-500'
    case 'done':
      return 'bg-green-500'
    case 'cancelled':
    case 'failed':
    case 'setup_failed':
      return 'bg-red-500'
    default: {
      // Unreachable while the switch is exhaustive — matches primary.ts's own
      // pattern, so a new machine state is a type error here too.
      const unhandled: never = state
      throw new Error(`No color for state: ${String(unhandled)}`)
    }
  }
}
