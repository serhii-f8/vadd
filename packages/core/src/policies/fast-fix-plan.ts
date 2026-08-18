import type { PlanTaskLike } from '../machine/types.js'

/**
 * Fast Fix's plan-time auto-approve check (spec §5, amendment A12). No diff
 * exists yet at `awaitingPlanApproval`, so this cannot reuse `classifyTaskRisk`
 * — it judges the plan's shape instead. Fast Fix's premise (D1) is a shortcut
 * for a trivial single-step bugfix; a plan proposing more than one task is
 * already signalling it isn't that case, and falls back to manual approval.
 *
 * Deliberately not a text heuristic (scanning titles/descriptions for
 * "migration", "auth", etc.) — unreliable in both directions, the same class
 * of fragile inference `command-policy.ts` warns against ("not a real
 * parser").
 */
export function fastFixPlanLooksSimple(tasks: PlanTaskLike[]): boolean {
  return tasks.length <= 1
}
