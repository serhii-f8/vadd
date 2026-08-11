import { expect, test } from 'vitest'
import { buildRepairPrompt } from '../src/prompts/repair-prompt.js'

test('leaves the body untouched when nothing was rejected', () => {
  expect(buildRepairPrompt('That turn owes evidence.', [])).toBe('That turn owes evidence.')
})

test('quotes the rejection so the agent knows what to correct', () => {
  const prompt = buildRepairPrompt('That turn owes decision_needed.', [
    'decision_needed: options.0.label — String must contain at most 80 character(s)',
  ])
  expect(prompt).toContain('That turn owes decision_needed.')
  expect(prompt).toContain('options.0.label')
  expect(prompt).toMatch(/80/)
})

test('tells the agent to correct the block rather than replace it', () => {
  // The failure this exists to prevent: the agent substitutes an unrelated
  // event because it believes it already sent the one being asked for.
  const prompt = buildRepairPrompt('owes x', ['failure: probableCause — Required'])
  expect(prompt).toMatch(/Do not send a different event/i)
})

test('lists every rejection', () => {
  const prompt = buildRepairPrompt('owes x', ['a: one', 'b: two'])
  expect(prompt).toContain('- a: one')
  expect(prompt).toContain('- b: two')
})
