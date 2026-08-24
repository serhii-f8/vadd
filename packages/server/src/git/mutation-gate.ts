import { MACHINE_STATES, type MachineStateName } from '@vadd/core'

export type GateVerdict = { allowed: true } | { allowed: false; reason: string }

/**
 * What is writing into the worktree in each state. Spec §3.
 *
 * Declared as a total record over `MachineStateName` plus the two
 * `objectives.status` values the machine never holds, so **adding a state to
 * the machine is a type error here** rather than a silent hole. This is the
 * same technique `packages/web/src/focus/primary.ts` uses to stay total over
 * `ViewStateName`, and it exists for the same reason: an unhandled state here
 * means an ungated mutation.
 */
const WRITER: Record<MachineStateName | 'creating' | 'setup_failed', string | null> = {
  idle: null,
  exploring: null,
  clarifying: null,
  proposing: null,
  awaitingDecision: null,
  planning: null,
  awaitingPlanApproval: null,
  executing: 'the agent is editing files in this worktree',
  verifying: 'the verification suite is running in this worktree',
  awaitingReview: null,
  revising: 'the agent is editing files in this worktree',
  rollingBack: 'a rollback is resetting this worktree',
  integrating: 'integration is committing and removing this worktree',
  done: null,
  paused: null,
  cancelled: null,
  failed: null,
  creating: 'setup commands are installing dependencies in this worktree',
  setup_failed: null,
}

export function gateForStatus(status: string): GateVerdict {
  if (!(status in WRITER)) {
    // Fails closed.
    //
    // `objectives.status` does carry a SQL CHECK naming exactly the nineteen
    // statuses (`objectives_status_check`, applied in `0003_integrate.sql`) —
    // so this branch is not, as it would be for an unconstrained column,
    // reachable from a value already sitting in the database. What makes it
    // reachable is the *type*: drizzle declares the column a bare `string`,
    // this function takes a `string`, and the CHECK is one migration away
    // from being widened by a state this map was never updated for. Running
    // a mutation against a worktree in an unknown condition is exactly what
    // the gate exists to prevent, so the unknown case refuses.
    return { allowed: false, reason: `Unrecognised objective status "${status}"` }
  }
  const writer = WRITER[status as keyof typeof WRITER]
  if (writer === null) return { allowed: true }
  return { allowed: false, reason: `Cannot modify git while ${status}: ${writer}` }
}

/**
 * Exported for the UI, which shows which states block a mutation.
 *
 * The widening to `string[]` before `concat` is load-bearing: `MACHINE_STATES`
 * is an `as const` tuple, so `filter` narrows the element type to
 * `MachineStateName`, and `'creating'` — an `objectives.status` the machine
 * never holds — is not one.
 */
export const BUSY_STATES: string[] = (MACHINE_STATES as readonly string[])
  .filter((s) => WRITER[s as keyof typeof WRITER] !== null)
  .concat('creating')
