import type { VerificationSpec } from '../schemas/verification.js'
import { normalizeChecks } from '../schemas/verification.js'
import type { EvidenceItemLike, WorkflowContext } from './types.js'

/**
 * Spec §5: every `required` verificationSpec item has an evidence item with
 * status `pass`, or `warn` where the item sets `allowWarn`, or `fail` where
 * the *current task* declared that exact command id in `expectFailing`
 * (amendment A11 — a deliberate TDD "red" step, scoped to the one command it
 * named, never a blanket exemption).
 *
 * `expectFailing` must be passed **only** from the `verifying` state's own
 * per-task guard. `integrating`'s `INTEGRATE` guard and the route's
 * pre-git-work check call this with no third argument on purpose — see
 * `workflow-machine.ts`'s `evidenceComplete` guard closure — so a plan whose
 * *last* task carries an exemption still cannot reach `done` on red evidence.
 *
 * Two refusals are deliberate and both come from spec §6's "detecting nothing
 * is an explicit outcome, never an empty — and therefore trivially green —
 * command set":
 *
 * - a null spec is never complete;
 * - a spec with nothing required and no checks is never complete.
 *
 * Without them, an objective whose verification was never resolved would walk
 * straight to `done` with a vacuously true guard, which is precisely the
 * failure the milestone exists to prevent.
 */
export function evidenceComplete(
  spec: VerificationSpec | null,
  items: readonly EvidenceItemLike[],
  expectFailing: readonly string[] = [],
): boolean {
  if (!spec) return false

  const required = spec.verify.commands.filter((c) => c.required)
  const checks = normalizeChecks(spec)
  if (required.length === 0 && checks.length === 0) return false

  for (const command of required) {
    const item = items.find((i) => i.commandId === command.id)
    if (!item) return false
    if (item.status === 'pass') continue
    if (item.status === 'warn' && command.allowWarn) continue
    if (item.status === 'fail' && expectFailing.includes(command.id)) continue
    return false
  }

  for (const check of checks) {
    const item = items.find((i) => i.commandId === check.id && i.kind === 'check')
    // A missing item and a non-passing one are the same answer here: the check
    // is not satisfied.
    if (item?.status !== 'pass') return false
  }

  return true
}

/** `'plan'`, or `` `task:${ord}` `` for a single task's review approval. */
export function userApproved(context: WorkflowContext, key: string): boolean {
  return context.approvals.includes(key)
}

/**
 * D1's Fast Fix. Routes `exploring → planning` and nothing else — it never
 * approves a plan (that is M2) and never skips verification (spec §5).
 */
export function isFastFix(context: WorkflowContext): boolean {
  return context.mode === 'fastfix'
}
