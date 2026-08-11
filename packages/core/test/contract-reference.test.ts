import { expect, test } from 'vitest'
import { AGENT_EVENT_TYPES } from '../src/schemas/agent-event.js'
import { contractReference } from '../src/schemas/contract-reference.js'

test('documents every event type in the union', () => {
  const ref = contractReference()
  for (const type of AGENT_EVENT_TYPES) {
    expect(ref, `missing section for ${type}`).toContain(`### ${type}`)
  }
})

test('states every enum value verbatim', () => {
  const ref = contractReference()
  for (const kind of ['test', 'diff', 'lint', 'build', 'check', 'artifact', 'warning']) {
    expect(ref).toContain(kind)
  }
  expect(ref).toMatch(/kind.*one of/)
})

test('states length caps, which exist only in the schema', () => {
  const ref = contractReference()
  // decision_needed.options[].label — the cap a real run overran.
  expect(ref).toMatch(/label.*80/)
  // evidence.summary — both the per-item cap and the array bound, stated so
  // the per-item one cannot be misread as bounding the array.
  expect(ref).toMatch(/summary.*at most 6 strings, each at most 100 chars/)
})

test('distinguishes required from optional fields', () => {
  const ref = contractReference()
  // artifactPath is the union's only optional field.
  expect(ref).toMatch(/artifactPath.*optional/)
  expect(ref).toMatch(/headline.*required/)
})

test('documents failure required fields, which no template example shows', () => {
  const ref = contractReference()
  const section = ref.slice(ref.indexOf('### failure'))
  expect(section).toContain('probableCause')
  expect(section).toContain('suggestedActions')
})

test('is derived from the schema, not hand-written', () => {
  // Guards the architecture rule: adding a Zod field must change this output
  // without anyone editing a second copy by hand.
  const ref = contractReference()
  expect(ref).toContain('recommendedId')
  expect(ref).toContain('evidenceRefs')
})

test('stays compact enough to inline into a profile CLAUDE.md', () => {
  expect(contractReference().split('\n').length).toBeLessThan(80)
})
