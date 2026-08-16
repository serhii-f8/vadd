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
