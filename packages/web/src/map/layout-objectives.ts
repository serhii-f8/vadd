import type { ObjectiveListRow } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { type StatusTone, statusFor } from '../routes/stateColor.js'

/** Column order for Quest Map — StatusTone's own declaration order, reused verbatim. */
export const TONE_ORDER: readonly StatusTone[] = ['idle', 'active', 'attention', 'done', 'failed']

export type MappedNode = {
  id: string
  column: StatusTone
  row: number
  objective: ObjectiveListRow
}

/**
 * Groups a project's objectives into the five status-tone columns Quest Map
 * renders, ordered within each column by most-recently-updated first. Pure —
 * no React, no @xyflow/react — testable with nothing but data in, data out.
 */
export function layoutObjectives(objectives: ObjectiveListRow[]): MappedNode[] {
  const byTone = new Map<StatusTone, ObjectiveListRow[]>(TONE_ORDER.map((tone) => [tone, []]))
  for (const o of objectives) {
    const tone = statusFor(o.status as ViewStateName).tone
    byTone.get(tone)?.push(o)
  }

  const result: MappedNode[] = []
  for (const tone of TONE_ORDER) {
    const rows = [...(byTone.get(tone) ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    rows.forEach((objective, row) => result.push({ id: objective.id, column: tone, row, objective }))
  }
  return result
}
