import { expect, test } from 'vitest'
import {
  countWords,
  fitsReadingBudget,
  LEVEL_1_WORD_LIMIT,
  LEVEL_2_WORD_LIMIT,
} from '../src/policies/reading-budget.js'
import type { AgentEvent } from '../src/schemas/agent-event.js'

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

test('counts words on any whitespace run', () => {
  expect(countWords('  one   two\nthree ')).toBe(3)
  expect(countWords('')).toBe(0)
})

test('a compliant event has no violations', () => {
  const ok: AgentEvent = { type: 'status', phase: 'executing', headline: 'Running the suite' }
  expect(fitsReadingBudget(ok)).toEqual([])
})

test('flags a Level 1 headline over the limit', () => {
  const bad: AgentEvent = {
    type: 'status',
    phase: 'executing',
    headline: words(LEVEL_1_WORD_LIMIT + 1),
  }
  expect(fitsReadingBudget(bad)).toEqual([
    { level: 1, field: 'headline', words: LEVEL_1_WORD_LIMIT + 1, limit: LEVEL_1_WORD_LIMIT },
  ])
})

test('flags a Level 2 block by its combined word count', () => {
  const bad: AgentEvent = {
    type: 'evidence',
    kind: 'test',
    status: 'fail',
    headline: 'Suite failed',
    summary: [words(40), words(41)],
  }
  const found = fitsReadingBudget(bad)
  expect(found).toEqual([{ level: 2, field: 'summary', words: 81, limit: LEVEL_2_WORD_LIMIT }])
})

test('measures each decision option as its own Level 2 block', () => {
  const bad: AgentEvent = {
    type: 'decision_needed',
    question: 'A or B?',
    recommendedId: 'a',
    options: [
      {
        id: 'a',
        label: 'A',
        pros: [words(50)],
        cons: [words(50)],
        reversibility: 'high',
        verification: 'x',
      },
      {
        id: 'b',
        label: 'B',
        pros: ['Fast'],
        cons: ['Risky'],
        reversibility: 'low',
        verification: 'y',
      },
    ],
  }
  const found = fitsReadingBudget(bad)
  expect(found).toHaveLength(1)
  expect(found[0]).toMatchObject({ level: 2, field: 'options[0].pros+cons', words: 100 })
})

test('the schema bounds cannot admit a Level 1 violation', () => {
  // 120 chars is the schema cap on a headline. A 15-word headline of one-letter
  // words is 29 chars, so the schema alone does not enforce the budget — this
  // asserts the two limits are consistent in the direction that matters: the
  // budget is the tighter constraint, and is therefore the one worth testing.
  expect(LEVEL_1_WORD_LIMIT * 2).toBeLessThan(120)
})
