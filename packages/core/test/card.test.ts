import { expect, test } from 'vitest'
import { AgentEvent } from '../src/schemas/agent-event.js'
import { ARTIFACT_MAX_CARDS, Card, CODE_LINE_CAP, DIAGRAM_LINE_CAP } from '../src/schemas/card.js'

const text = { id: 'why', kind: 'text', title: 'Why a queue', body: 'Because requests time out.' }
const table = {
  id: 'cmp',
  kind: 'table',
  title: 'Costs',
  role: 'comparison',
  columns: ['', 'Queue', 'Inline'],
  rows: [['Moving parts', 'Worker', 'None']],
}
const code = { id: 'job', kind: 'code', title: 'Job row', language: 'ts', code: 'type Job = {}' }
const diagram = {
  id: 'flow',
  kind: 'diagram',
  title: 'Flow',
  notation: 'mermaid',
  source: 'flowchart LR\n  A --> B',
}

test('each kind parses a valid card', () => {
  for (const c of [text, table, code, diagram]) {
    expect(Card.safeParse(c).success, JSON.stringify(c)).toBe(true)
  }
})

test('role is optional and closed', () => {
  expect(Card.safeParse({ ...text, role: 'architecture' }).success).toBe(true)
  expect(Card.safeParse({ ...text, role: 'summary' }).success).toBe(false)
})

test('title and id caps', () => {
  expect(Card.safeParse({ ...text, title: 'x'.repeat(81) }).success).toBe(false)
  expect(Card.safeParse({ ...text, id: 'x'.repeat(41) }).success).toBe(false)
  expect(Card.safeParse({ ...text, id: '' }).success).toBe(false)
})

test('text body cap', () => {
  expect(Card.safeParse({ ...text, body: 'x'.repeat(600) }).success).toBe(true)
  expect(Card.safeParse({ ...text, body: 'x'.repeat(601) }).success).toBe(false)
})

test('table shape caps', () => {
  expect(Card.safeParse({ ...table, columns: ['only'] }).success).toBe(false)
  expect(Card.safeParse({ ...table, columns: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false)
  expect(Card.safeParse({ ...table, rows: [] }).success).toBe(false)
  const seven = Array.from({ length: 7 }, () => ['a', 'b', 'c'])
  expect(Card.safeParse({ ...table, rows: seven }).success).toBe(false)
  expect(Card.safeParse({ ...table, rows: [['a', 'b', 'x'.repeat(81)]] }).success).toBe(false)
})

test('a table row one cell short is rejected, naming the row', () => {
  const r = Card.safeParse({ ...table, rows: [['a', 'b', 'c'], ['a', 'b']] })
  expect(r.success).toBe(false)
  if (!r.success) expect(r.error.issues[0]?.path).toEqual(['rows', 1])
})

test('code line and length caps', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')
  expect(Card.safeParse({ ...code, code: lines(CODE_LINE_CAP) }).success).toBe(true)
  expect(Card.safeParse({ ...code, code: lines(CODE_LINE_CAP + 1) }).success).toBe(false)
  expect(Card.safeParse({ ...code, code: 'x'.repeat(1501) }).success).toBe(false)
  expect(Card.safeParse({ ...code, language: '' }).success).toBe(false)
  expect(Card.safeParse({ ...code, caption: 'x'.repeat(121) }).success).toBe(false)
})

test('diagram line cap and closed notation', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `A${i} --> B${i}`).join('\n')
  expect(Card.safeParse({ ...diagram, source: lines(DIAGRAM_LINE_CAP) }).success).toBe(true)
  expect(Card.safeParse({ ...diagram, source: lines(DIAGRAM_LINE_CAP + 1) }).success).toBe(false)
  expect(Card.safeParse({ ...diagram, notation: 'plantuml' }).success).toBe(false)
})

test('an artifact event carries 1–6 cards and nothing else', () => {
  expect(AgentEvent.safeParse({ type: 'artifact', cards: [text] }).success).toBe(true)
  expect(AgentEvent.safeParse({ type: 'artifact', cards: [] }).success).toBe(false)
  const seven = Array.from({ length: ARTIFACT_MAX_CARDS + 1 }, (_, i) => ({ ...text, id: `t${i}` }))
  expect(AgentEvent.safeParse({ type: 'artifact', cards: seven }).success).toBe(false)
  expect(AgentEvent.safeParse({ type: 'artifact', cards: [text], inReplyTo: 'x' }).success).toBe(
    false,
  )
})
