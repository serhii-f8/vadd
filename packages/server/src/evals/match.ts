import type { AgentEvent } from '@vadd/core'
import { compileRegex, GATED_TYPES, type Label } from './labels.js'

export type MatchResult = {
  matched: { label: Label; event: AgentEvent }[]
  missed: Label[]
  falsePositives: { turn: number; event: AgentEvent }[]
}

const EXACT = new Set(['kind', 'status'])

function satisfies(event: AgentEvent, label: Label): boolean {
  if (event.type !== label.type) return false
  const record = event as unknown as Record<string, unknown>
  for (const [field, pattern] of Object.entries(label.match)) {
    const value = record[field]
    if (typeof value !== 'string') return false
    if (EXACT.has(field)) {
      if (value !== pattern) return false
    } else if (!compileRegex(pattern).test(value)) {
      return false
    }
  }
  return true
}

/**
 * Scores emissions against exhaustive ground truth.
 *
 * Labels are exhaustive for the gated types by construction (design §5.5), so
 * any emission of a gated type that matches no label is a false positive. That
 * is what forces the labels to mean "should have surfaced" rather than "did
 * surface" — without it, recall could be gamed by labelling only what the agent
 * happened to emit.
 *
 * Each label is consumed at most once, earliest emission first: a second
 * decision card for one decision is a real defect.
 */
export function matchEmissions(labels: Label[], byTurn: Map<number, AgentEvent[]>): MatchResult {
  const matched: MatchResult['matched'] = []
  const missed: Label[] = []
  const used = new Set<AgentEvent>()

  for (const label of labels) {
    const candidates = byTurn.get(label.turn) ?? []
    const hit = candidates.find((e) => !used.has(e) && satisfies(e, label))
    if (hit) {
      used.add(hit)
      matched.push({ label, event: hit })
    } else {
      missed.push(label)
    }
  }

  const falsePositives: MatchResult['falsePositives'] = []
  for (const [turn, events] of byTurn) {
    for (const event of events) {
      if (used.has(event)) continue
      if (!(GATED_TYPES as readonly string[]).includes(event.type)) continue
      falsePositives.push({ turn, event })
    }
  }

  return { matched, missed, falsePositives }
}
