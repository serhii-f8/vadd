import type { ViewStateName } from '../focus/primary.js'

export type StatusTone = 'idle' | 'active' | 'attention' | 'done' | 'failed'

export type StatusDescriptor = {
  tone: StatusTone
  /** A Tailwind class reading a theme token — never a fixed palette value. */
  dot: string
  /** What the dot means, for a tooltip and for screen readers. */
  label: string
}

const TONES: Record<StatusTone, Omit<StatusDescriptor, 'tone'>> = {
  idle: { dot: 'bg-status-idle', label: 'Idle' },
  active: { dot: 'bg-status-active', label: 'Working' },
  attention: { dot: 'bg-status-attention', label: 'Needs you' },
  done: { dot: 'bg-status-done', label: 'Done' },
  failed: { dot: 'bg-status-failed', label: 'Failed' },
}

function descriptor(tone: StatusTone): StatusDescriptor {
  return { tone, ...TONES[tone] }
}

/**
 * The 5-tone semantic mapping, not the raw 19 view states — the point is
 * scanning "what needs me" across many objectives without reading each state
 * word (M2 shadcn visual pass design doc §3).
 *
 * Written as an exhaustive switch rather than a record so that adding a state
 * to the machine is a **type error here**, matching `primary.ts`.
 */
export function statusFor(state: ViewStateName): StatusDescriptor {
  switch (state) {
    case 'idle':
    case 'creating':
      return descriptor('idle')
    case 'exploring':
    case 'proposing':
    case 'planning':
    case 'executing':
    case 'verifying':
    case 'revising':
    case 'rollingBack':
    case 'integrating':
      return descriptor('active')
    case 'awaitingDecision':
    case 'clarifying':
    case 'awaitingPlanApproval':
    case 'awaitingReview':
    case 'paused':
      return descriptor('attention')
    case 'done':
      return descriptor('done')
    case 'cancelled':
    case 'failed':
    case 'setup_failed':
      return descriptor('failed')
    default: {
      const unhandled: never = state
      throw new Error(`No status for state: ${String(unhandled)}`)
    }
  }
}

/** Dot class only. Retained for call sites that need nothing else. */
export function stateColor(state: ViewStateName): string {
  return statusFor(state).dot
}
