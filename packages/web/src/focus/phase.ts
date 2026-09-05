import type { Objective, PlanTask } from '../api.js'
import type { ViewStateName } from './primary.js'

export const PHASE_KEYS = [
  'explore',
  'propose',
  'plan',
  'execute',
  'verify',
  'review',
  'integrate',
] as const
export type PhaseKey = (typeof PHASE_KEYS)[number]
export type PhaseStatus = 'done' | 'current' | 'todo' | 'skipped'
export type Phase = { key: PhaseKey; label: string; status: PhaseStatus }

export type PhaseInput = {
  state: ViewStateName
  mode: Objective['mode']
  tasks: ReadonlyArray<{ status: PlanTask['status'] }>
  decisions: ReadonlyArray<unknown>
  /** `lastStatus.phase` off the aggregate: the prompt phase the agent last reported. */
  lastStatusPhase: string | null
}

const LABELS: Record<PhaseKey, string> = {
  explore: 'Explore',
  propose: 'Propose',
  plan: 'Plan',
  execute: 'Execute',
  verify: 'Verify',
  review: 'Review',
  integrate: 'Integrate',
}

/** Prompt template names (`packages/server/src/prompts/renderer.ts`) → phase. */
const PROMPT_PHASE: Record<string, PhaseKey> = {
  explore: 'explore',
  clarify: 'explore',
  propose: 'propose',
  plan: 'plan',
  'execute-task': 'execute',
  'execute-task-investigation': 'execute',
  verify: 'verify',
  review: 'review',
}

/**
 * The phase a state is in; `'all'` once everything is done; `null` for the
 * states that carry no phase of their own (paused, failed, ...) and have to
 * have it inferred from what the objective got as far as.
 */
function phaseOfState(state: ViewStateName): PhaseKey | 'all' | null {
  switch (state) {
    case 'idle':
    case 'creating':
    case 'exploring':
    case 'clarifying':
      return 'explore'
    case 'proposing':
    case 'awaitingDecision':
      return 'propose'
    case 'planning':
    case 'awaitingPlanApproval':
      return 'plan'
    case 'executing':
    case 'revising':
    case 'rollingBack':
      return 'execute'
    case 'verifying':
      return 'verify'
    case 'awaitingReview':
      return 'review'
    case 'integrating':
      return 'integrate'
    case 'done':
      return 'all'
    case 'paused':
    case 'cancelled':
    case 'failed':
    case 'setup_failed':
      return null
    default: {
      const unhandled: never = state
      throw new Error(`No phase for state: ${String(unhandled)}`)
    }
  }
}

/** Most specific evidence first: the agent's own last phase, then the plan, then decisions. */
function inferPhase(input: PhaseInput): PhaseKey {
  const fromPrompt =
    input.lastStatusPhase === null ? undefined : PROMPT_PHASE[input.lastStatusPhase]
  if (fromPrompt !== undefined) return fromPrompt
  if (
    input.tasks.some(
      (t) => t.status === 'running' || t.status === 'verified' || t.status === 'failed',
    )
  ) {
    return 'execute'
  }
  if (input.tasks.length > 0) return 'plan'
  if (input.decisions.length > 0) return 'propose'
  return 'explore'
}

/**
 * The seven workflow phases with a status each, for the Focus View's stepper.
 * Pure: the machine's own state is the source of truth, and this only reads it
 * (spec §7 — no client-side transitions).
 */
export function phasesFor(input: PhaseInput): Phase[] {
  const own = phaseOfState(input.state)
  const current = own === 'all' ? null : (own ?? inferPhase(input))
  const currentIdx = current === null ? PHASE_KEYS.length : PHASE_KEYS.indexOf(current)
  return PHASE_KEYS.map((key, i) => {
    const label = key === 'integrate' && input.mode === 'investigation' ? 'Finish' : LABELS[key]
    // The machine routes `exploring → planning` on Fast Fix (D2): no proposal.
    if (key === 'propose' && input.mode === 'fastfix') return { key, label, status: 'skipped' }
    const status: PhaseStatus = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo'
    return { key, label, status }
  })
}
