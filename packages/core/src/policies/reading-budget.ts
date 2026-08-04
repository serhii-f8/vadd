import type { AgentEvent } from '../schemas/agent-event.js'

/** Spec §10: "any Level 1 string > 15 words … fails a unit test". */
export const LEVEL_1_WORD_LIMIT = 15
/** Spec §10: "… or Level 2 block > 80 words". */
export const LEVEL_2_WORD_LIMIT = 80

export type BudgetViolation = {
  level: 1 | 2
  /** Dotted path of the offending field, e.g. `options[0].pros+cons`. */
  field: string
  words: number
  limit: number
}

export function countWords(s: string): number {
  const trimmed = s.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/**
 * Spec §10 states the budget but not which fields are Level 1 and which are
 * Level 2, so this function is the definition (design §4.2).
 *
 * Level 1 = a single string surfaced on its own. Level 2 = a group rendered as
 * one unit, measured by its combined word count — five 20-word bullets are as
 * expensive to read as one 100-word paragraph.
 */
export function fitsReadingBudget(event: AgentEvent): BudgetViolation[] {
  const found: BudgetViolation[] = []

  const level1 = (field: string, value: string): void => {
    const words = countWords(value)
    if (words > LEVEL_1_WORD_LIMIT) {
      found.push({ level: 1, field, words, limit: LEVEL_1_WORD_LIMIT })
    }
  }
  const level2 = (field: string, parts: string[]): void => {
    const words = parts.reduce((sum, p) => sum + countWords(p), 0)
    if (words > LEVEL_2_WORD_LIMIT) {
      found.push({ level: 2, field, words, limit: LEVEL_2_WORD_LIMIT })
    }
  }

  switch (event.type) {
    case 'status':
      level1('headline', event.headline)
      break
    case 'decision_needed':
      level1('question', event.question)
      event.options.forEach((o, i) => {
        level1(`options[${i}].label`, o.label)
        level1(`options[${i}].verification`, o.verification)
        level2(`options[${i}].pros+cons`, [...o.pros, ...o.cons])
      })
      break
    case 'clarification':
      level1('question', event.question)
      level2('suggestedAnswers', event.suggestedAnswers)
      break
    case 'plan':
      event.tasks.forEach((t, i) => {
        level1(`tasks[${i}].title`, t.title)
        level2(`tasks[${i}].description`, [t.description])
      })
      break
    case 'task_result':
      level1('claim', event.claim)
      break
    case 'evidence':
      level1('headline', event.headline)
      level2('summary', event.summary)
      break
    case 'failure':
      level1('headline', event.headline)
      level2('probableCause+suggestedActions', [event.probableCause, ...event.suggestedActions])
      break
  }
  return found
}
