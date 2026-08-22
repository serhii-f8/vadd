/**
 * A pure, deterministic priority score for one `decision_needed` option —
 * amendment A16. Not literal AHP (no pairwise comparison): a fixed formula
 * over fields the agent already provides, matching a subset of
 * `Decision['options'][number]` in `packages/web/src/api.ts` (no `id`,
 * `label` or `verification`), so no adapter is needed at the call site.
 */
export type ScorableOption = {
  reversibility: 'high' | 'medium' | 'low'
  effort?: 'S' | 'M' | 'L'
  pros: string[]
  cons: string[]
}

const REVERSIBILITY_SCORE = { high: 1.0, medium: 0.6, low: 0.2 } as const
const EFFORT_SCORE = { S: 1.0, M: 0.6, L: 0.2 } as const
/** Absent effort is treated as 'M' — a plain-text label, not worth a dynamic reweight. */
const EFFORT_NEUTRAL = EFFORT_SCORE.M

/**
 * Weights (0.5/0.3/0.2) reflect the schema's own emphasis: `reversibility`
 * is the only mandatory field (spec §4's safety-critical one), `effort` is
 * optional supporting context, and the pros/cons balance is the softest
 * signal — an agent's own listed tradeoffs, not an independent measurement.
 * Fixed, not configurable (design doc §3/§7) — revisit only with real usage
 * evidence the weights are wrong.
 */
export function scoreOption(option: ScorableOption): number {
  const reversibility = REVERSIBILITY_SCORE[option.reversibility]
  const effort = option.effort ? EFFORT_SCORE[option.effort] : EFFORT_NEUTRAL
  // pros.length - cons.length ranges [-5, 5] (both capped at 5 by the
  // decision_needed schema); normalized to [0, 1], with no pros/cons at all
  // landing at the neutral 0.5. Clamped structurally rather than trusting
  // that cap to hold forever.
  const prosConsBalance = Math.min(
    1,
    Math.max(0, (option.pros.length - option.cons.length + 5) / 10),
  )

  return 0.5 * reversibility + 0.3 * effort + 0.2 * prosConsBalance
}
