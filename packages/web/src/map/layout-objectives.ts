import type { ObjectiveListRow } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { type StatusTone, statusFor } from '../routes/stateColor.js'

/**
 * The height every `ObjectiveNode` card is pinned to, and the vertical pitch
 * the canvas lays them out on.
 *
 * They live together because they are one fact: React Flow positions nodes
 * absolutely, so a card that renders taller than its slot silently covers the
 * card below it. That shipped — an investigation objective's chip row wraps to
 * a second line and measured 116px in Chrome against a 96px pitch, hiding 20px
 * of the next node. The card is given `NODE_HEIGHT` explicitly rather than
 * being left to size itself, so the two can only disagree by someone editing
 * this file.
 */
export const NODE_HEIGHT = 116
export const ROW_HEIGHT = NODE_HEIGHT + 16

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
    const rows = [...(byTone.get(tone) ?? [])].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )
    rows.forEach((objective, row) => {
      result.push({ id: objective.id, column: tone, row, objective })
    })
  }
  return result
}
