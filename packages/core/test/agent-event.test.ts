import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { AGENT_EVENT_TYPES, AgentEvent } from '../src/schemas/agent-event.js'
import { agentEventJsonSchema } from '../src/schemas/json-schema.js'

test('accepts a well-formed decision_needed', () => {
  const parsed = AgentEvent.safeParse({
    type: 'decision_needed',
    question: 'Queue the export or run it synchronously?',
    options: [
      {
        id: 'queue',
        label: 'Queue it',
        pros: ['No request timeout'],
        cons: ['Needs a worker'],
        reversibility: 'high',
        verification: 'Job appears in the queue table',
      },
      {
        id: 'sync',
        label: 'Run it inline',
        pros: ['Simplest'],
        cons: ['Times out over 30s'],
        reversibility: 'high',
        verification: 'Response returns under 30s',
      },
    ],
    recommendedId: 'queue',
  })
  expect(parsed.success).toBe(true)
})

test('rejects a decision with only one option', () => {
  const parsed = AgentEvent.safeParse({
    type: 'decision_needed',
    question: 'Which?',
    options: [
      { id: 'a', label: 'A', pros: [], cons: [], reversibility: 'high', verification: 'x' },
    ],
    recommendedId: 'a',
  })
  expect(parsed.success).toBe(false)
})

test('rejects an unknown event type', () => {
  expect(AgentEvent.safeParse({ type: 'invented', headline: 'x' }).success).toBe(false)
})

test('rejects reversibility being omitted — the one mandatory analysis field', () => {
  const parsed = AgentEvent.safeParse({
    type: 'decision_needed',
    question: 'Which?',
    options: [
      { id: 'a', label: 'A', pros: [], cons: [], verification: 'x' },
      { id: 'b', label: 'B', pros: [], cons: [], reversibility: 'low', verification: 'y' },
    ],
    recommendedId: 'a',
  })
  expect(parsed.success).toBe(false)
})

test('every declared type parses at least one fixture', () => {
  const fixtures: Record<string, unknown> = {
    status: { type: 'status', phase: 'executing', headline: 'Running the test suite' },
    decision_needed: {
      type: 'decision_needed',
      question: 'A or B?',
      recommendedId: 'a',
      options: [
        { id: 'a', label: 'A', pros: [], cons: [], reversibility: 'high', verification: 'x' },
        { id: 'b', label: 'B', pros: [], cons: [], reversibility: 'low', verification: 'y' },
      ],
    },
    clarification: { type: 'clarification', question: 'Which env?', suggestedAnswers: ['local'] },
    plan: { type: 'plan', tasks: [{ title: 'Add a failing test', description: 'Cover the bug' }] },
    task_result: {
      type: 'task_result',
      taskId: 't1',
      claim: 'Test now passes',
      evidenceRefs: ['e1'],
    },
    evidence: {
      type: 'evidence',
      kind: 'test',
      status: 'pass',
      headline: 'OK (12 tests)',
      summary: [],
    },
    failure: {
      type: 'failure',
      headline: 'Suite failed',
      probableCause: 'Missing .env',
      suggestedActions: ['Copy .env.example'],
    },
    memory_note: {
      type: 'memory_note',
      kind: 'architecture',
      headline: 'Auth lives in src/auth/',
      content: 'JWT validation happens in middleware.ts.',
    },
  }
  for (const type of AGENT_EVENT_TYPES) {
    expect(AgentEvent.safeParse(fixtures[type]).success, type).toBe(true)
  }
})

test('the checked-in JSON Schema matches what the code generates', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const file = join(repoRoot, 'prompts', 'claude-code', 'v1', 'agent-event.schema.json')
  const checkedIn = JSON.parse(readFileSync(file, 'utf8'))
  // Regenerate with `pnpm schema:export` when this fails.
  expect(checkedIn).toEqual(agentEventJsonSchema())
})

test('A6: evidence accepts an optional checkId', () => {
  const withId = AgentEvent.safeParse({
    type: 'evidence',
    kind: 'check',
    checkId: 'check-1',
    status: 'pass',
    headline: 'Reproduced by a failing-then-passing test',
    summary: [],
  })
  expect(withId.success).toBe(true)
  if (withId.success && withId.data.type === 'evidence') {
    expect(withId.data.checkId).toBe('check-1')
  }
})

test('A6: checkId is optional, so existing corpus events still parse', () => {
  const without = AgentEvent.safeParse({
    type: 'evidence',
    kind: 'lint',
    status: 'warn',
    headline: '3 warnings, 0 errors',
    summary: ['Two unused imports'],
  })
  expect(without.success).toBe(true)
})

test('A6: an over-long checkId is refused', () => {
  const parsed = AgentEvent.safeParse({
    type: 'evidence',
    kind: 'check',
    checkId: 'c'.repeat(41),
    status: 'pass',
    headline: 'x',
    summary: [],
  })
  expect(parsed.success).toBe(false)
})

test('evidence accepts kind: security', () => {
  const parsed = AgentEvent.safeParse({
    type: 'evidence',
    kind: 'security',
    checkId: 'security-audit',
    status: 'pass',
    headline: 'pnpm audit found no high-severity advisories',
    summary: [],
  })
  expect(parsed.success).toBe(true)
})

test('A11: a plan task accepts an optional expectFailing naming verification command ids', () => {
  const result = AgentEvent.safeParse({
    type: 'plan',
    tasks: [
      {
        title: 'Add a failing test for the empty backspace',
        description: 'Cover the reported case before changing behaviour.',
        expectFailing: ['test'],
      },
      { title: 'Fix it', description: 'patch' },
    ],
  })
  expect(result.success).toBe(true)
  if (result.success && result.data.type === 'plan') {
    expect(result.data.tasks[0]?.expectFailing).toEqual(['test'])
    expect(result.data.tasks[1]?.expectFailing).toBeUndefined()
  }
})

test('A11: expectFailing is capped at 5 ids of 40 chars each, and existing plans without it still parse', () => {
  expect(
    AgentEvent.safeParse({
      type: 'plan',
      tasks: [{ title: 'x', description: 'y' }],
    }).success,
  ).toBe(true)
  expect(
    AgentEvent.safeParse({
      type: 'plan',
      tasks: [{ title: 'x', description: 'y', expectFailing: Array(6).fill('a') }],
    }).success,
  ).toBe(false)
  expect(
    AgentEvent.safeParse({
      type: 'plan',
      tasks: [{ title: 'x', description: 'y', expectFailing: ['a'.repeat(41)] }],
    }).success,
  ).toBe(false)
})

test('memory_note accepts a valid instance', () => {
  const result = AgentEvent.safeParse({
    type: 'memory_note',
    kind: 'architecture',
    headline: 'Auth lives in src/auth/',
    content: 'JWT validation happens in middleware.ts, not in individual routes.',
  })
  expect(result.success).toBe(true)
})

test('memory_note rejects an over-length headline', () => {
  const result = AgentEvent.safeParse({
    type: 'memory_note',
    kind: 'architecture',
    headline: 'x'.repeat(121),
    content: 'y',
  })
  expect(result.success).toBe(false)
})

test('memory_note rejects an over-length content', () => {
  const result = AgentEvent.safeParse({
    type: 'memory_note',
    kind: 'known_issue',
    headline: 'x',
    content: 'y'.repeat(401),
  })
  expect(result.success).toBe(false)
})

test('memory_note rejects an unrecognized kind', () => {
  const result = AgentEvent.safeParse({
    type: 'memory_note',
    kind: 'nonsense',
    headline: 'x',
    content: 'y',
  })
  expect(result.success).toBe(false)
})
