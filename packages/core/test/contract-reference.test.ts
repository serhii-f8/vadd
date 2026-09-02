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

test('A24: documents every card kind under artifact, with its fields and caps', () => {
  const ref = contractReference()
  const section = ref.slice(ref.indexOf('### artifact'))
  expect(section).toMatch(/cards.*1–6 objects, one of the kinds below/)
  for (const kind of ['text', 'table', 'code', 'diagram']) {
    expect(section, `missing kind ${kind}`).toMatch(new RegExp(`kind \`${kind}\``))
  }
  expect(section).toMatch(/title.*at most 80/)
  expect(section).toMatch(/body.*at most 600/)
  expect(section).toMatch(/columns.*2–4 strings, each at most 40/)
  expect(section).toMatch(/rows.*1–6 arrays, each cell at most 80 chars/)
  expect(section).toMatch(/language.*at most 20/)
  // `z.literal` exports as `const`, not `enum` — the reference must say so.
  expect(section).toMatch(/notation.*exactly "mermaid"/)
  expect(section).toMatch(/role.*optional.*one of architecture \| comparison \| interface \| note/)
})

test('stays compact enough to inline into a profile CLAUDE.md', () => {
  // Raised from 80 when A24 added the four-kind card union: the artifact
  // section alone is ~30 lines, and every one of them is a cap the agent can
  // learn nowhere else.
  expect(contractReference().split('\n').length).toBeLessThan(130)
})
