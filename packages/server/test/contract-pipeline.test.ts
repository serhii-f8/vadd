import type { RawAgentUpdate } from '@vadd/core'
import { expect, test } from 'vitest'
import { type ContractEmission, ContractPipeline } from '../src/contract/pipeline.js'

function chunk(text: string): RawAgentUpdate {
  return {
    sessionId: 's1',
    receivedAt: '2026-08-04T00:00:00.000Z',
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  }
}
function thought(text: string): RawAgentUpdate {
  return {
    sessionId: 's1',
    receivedAt: '2026-08-04T00:00:00.000Z',
    update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } },
  }
}

function collect(): { out: ContractEmission[]; pipe: ContractPipeline } {
  const out: ContractEmission[] = []
  return { out, pipe: new ContractPipeline({ onEmit: (e) => out.push(e) }) }
}

const STATUS = '```vadd-event\n{"type":"status","phase":"executing","headline":"Running"}\n```\n'

test('emits a validated event from a fenced block', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk(STATUS), 42)
  await pipe.endTurn('t1')
  expect(out).toEqual([
    {
      kind: 'event',
      turnId: 't1',
      extracted: false,
      sourceEventIds: [42],
      event: { type: 'status', phase: 'executing', headline: 'Running' },
    },
  ])
})

test('ignores thought chunks — a drafted event is not a claim', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(thought(STATUS), 1)
  await pipe.endTurn('t1')
  expect(out).toEqual([])
})

test('emits each element of an array payload separately', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(
    chunk(
      '```vadd-event\n[{"type":"status","phase":"executing","headline":"A"},' +
        '{"type":"status","phase":"verifying","headline":"B"}]\n```\n',
    ),
    7,
  )
  await pipe.endTurn('t1')
  expect(out.map((e) => (e.kind === 'event' ? e.event : e.kind))).toEqual([
    { type: 'status', phase: 'executing', headline: 'A' },
    { type: 'status', phase: 'verifying', headline: 'B' },
  ])
})

test('records an empty array payload as a violation instead of vanishing', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk('```vadd-event\n[]\n```\n'), 20)
  await pipe.endTurn('t1')
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({ kind: 'violation', reason: 'schema', raw: '[]' })
})

test('records a parse failure instead of dropping it', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk('```vadd-event\n{not json\n```\n'), 3)
  await pipe.endTurn('t1')
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({ kind: 'violation', reason: 'parse', raw: '{not json' })
})

test('records a schema failure with the Zod issues attached', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk('```vadd-event\n{"type":"status","headline":"no phase"}\n```\n'), 4)
  await pipe.endTurn('t1')
  expect(out).toHaveLength(1)
  const v = out[0]
  if (v === undefined) throw new Error('unreachable')
  expect(v.kind).toBe('violation')
  if (v.kind !== 'violation') throw new Error('unreachable')
  expect(v.reason).toBe('schema')
  expect(Array.isArray(v.issues)).toBe(true)
})

test('records an unterminated fence at end of turn', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk('```vadd-event\n{"type":"status"\n'), 5)
  await pipe.endTurn('t1')
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({
    kind: 'violation',
    reason: 'unterminated',
    raw: '{"type":"status"',
  })
})

test('falls back to a status event when an expected type never arrives', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1', expect: [['plan']] })
  pipe.ingest(chunk('I thought about it but never emitted a block.\n'), 6)
  await pipe.endTurn('t1')
  expect(out).toHaveLength(2)
  expect(out[0]).toMatchObject({ kind: 'violation', reason: 'missing_expected' })
  expect(out[1]).toMatchObject({
    kind: 'event',
    event: { type: 'status', headline: 'Unstructured output — open raw view' },
  })
})

test('does not fall back when the expected type did arrive', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1', expect: [['status']] })
  pipe.ingest(chunk(STATUS), 8)
  await pipe.endTurn('t1')
  expect(out).toHaveLength(1)
  expect(out[0]?.kind).toBe('event')
})

test("a new turn does not inherit the previous turn's buffer", async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk('```vadd-event\ndangling\n'), 9)
  await pipe.endTurn('t1')
  out.length = 0

  pipe.beginTurn({ turnId: 't2' })
  pipe.ingest(chunk(STATUS), 10)
  await pipe.endTurn('t2')
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({ kind: 'event', turnId: 't2' })
})

test('ingest outside a turn is dropped rather than throwing', async () => {
  const { out, pipe } = collect()
  pipe.ingest(chunk(STATUS), 11)
  expect(out).toEqual([])
})

// `expects` entries are alternation groups: a group is satisfied when ANY of
// its members arrives. The flat AND reading fired `missing_expected` on every
// successful `execute-task` turn, because that template lists `failure` — the
// alternative to `task_result`, which a successful turn correctly never emits.
// The turn was then told "Unstructured output — open raw view" despite being
// fully structured, which is thesis 1 inverted.
const TASK_RESULT =
  '```vadd-event\n{"type":"task_result","taskId":"t","claim":"Done","evidenceRefs":["One line removed"]}\n```\n'
const EVIDENCE =
  '```vadd-event\n{"type":"evidence","kind":"diff","status":"pass","headline":"One line removed","summary":["ok"]}\n```\n'
const FAILURE =
  '```vadd-event\n{"type":"failure","headline":"Could not build","probableCause":"No lockfile","suggestedActions":["Run install"]}\n```\n'
const EXECUTE_TASK_EXPECT = [
  ['task_result', 'failure'],
  ['evidence', 'failure'],
] as const

test('a successful execute-task turn satisfies every alternation group', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1', expect: EXECUTE_TASK_EXPECT.map((g) => [...g]) })
  pipe.ingest(chunk(EVIDENCE), 20)
  pipe.ingest(chunk(TASK_RESULT), 21)
  await pipe.endTurn('t1')
  expect(out.filter((e) => e.kind === 'violation')).toEqual([])
})

test('a failure-only execute-task turn satisfies every alternation group', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1', expect: EXECUTE_TASK_EXPECT.map((g) => [...g]) })
  pipe.ingest(chunk(FAILURE), 22)
  await pipe.endTurn('t1')
  expect(out.filter((e) => e.kind === 'violation')).toEqual([])
})

test('an execute-task turn emitting only evidence still reports the unmet group', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1', expect: EXECUTE_TASK_EXPECT.map((g) => [...g]) })
  pipe.ingest(chunk(EVIDENCE), 23)
  await pipe.endTurn('t1')
  const violations = out.filter((e) => e.kind === 'violation')
  expect(violations).toHaveLength(1)
  expect(violations[0]).toMatchObject({
    reason: 'missing_expected',
    raw: 'expected task_result or failure',
  })
})

test('unmetExpectations reports groups nothing satisfied, without side effects', async () => {
  const emitted: ContractEmission[] = []
  const pipe = new ContractPipeline({ onEmit: (e) => emitted.push(e) })
  pipe.beginTurn({
    turnId: 't1',
    expect: [
      ['evidence', 'failure'],
      ['task_result', 'failure'],
    ],
  })
  pipe.ingest({
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: '```vadd-event\n{"type":"task_result","taskId":"t","claim":"done","evidenceRefs":[]}\n```\n',
      },
    },
  } as never)

  expect(pipe.unmetExpectations()).toEqual([['evidence', 'failure']])
  // Asking is not answering: no violation, no fallback, turn still open.
  expect(emitted.filter((e) => e.kind === 'violation')).toHaveLength(0)
  expect(pipe.turnActive).toBe(true)
  // Idempotent.
  expect(pipe.unmetExpectations()).toEqual([['evidence', 'failure']])

  await pipe.endTurn('t1')
  expect(pipe.unmetExpectations()).toEqual([])
})

test('a drift close emits the block AND a fence_drift violation', async () => {
  const emitted: ContractEmission[] = []
  const pipe = new ContractPipeline({ onEmit: (e) => emitted.push(e) })
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest({
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: '```vadd-event\n{"type":"status","phase":"executing","headline":"Running tests"}\n```and then I checked the config\n',
      },
    },
  } as never)
  await pipe.endTurn('t1')

  const events = emitted.filter((e) => e.kind === 'event')
  const drift = emitted.filter((e) => e.kind === 'violation' && e.reason === 'fence_drift')
  expect(events).toHaveLength(1)
  expect(drift).toHaveLength(1)
  expect(drift[0]).toMatchObject({ raw: 'and then I checked the config' })
})

const LINT_EVIDENCE =
  '```vadd-event\n{"type":"evidence","kind":"lint","status":"pass","headline":"Pint passed","summary":[]}\n```\n'
const TASK_RESULT_DANGLING =
  '```vadd-event\n{"type":"task_result","taskId":"t","claim":"done","evidenceRefs":["OK (1 test)"]}\n```\n'
const TASK_RESULT_RESOLVED =
  '```vadd-event\n{"type":"task_result","taskId":"t","claim":"done","evidenceRefs":["Pint passed"]}\n```\n'

test('danglingEvidenceRefs reports a claim naming evidence that was never emitted', async () => {
  const { pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk(LINT_EVIDENCE), 1)
  pipe.ingest(chunk(TASK_RESULT_DANGLING), 2)
  expect(pipe.danglingEvidenceRefs()).toEqual(['OK (1 test)'])
})

test('danglingEvidenceRefs is empty when every claimed ref resolves', async () => {
  const { pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk(LINT_EVIDENCE), 1)
  pipe.ingest(chunk(TASK_RESULT_RESOLVED), 2)
  expect(pipe.danglingEvidenceRefs()).toEqual([])
})

test('danglingEvidenceRefs is empty outside a turn', () => {
  const { pipe } = collect()
  expect(pipe.danglingEvidenceRefs()).toEqual([])
})

test('a still-dangling ref becomes a violation at endTurn, alongside the events', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk(LINT_EVIDENCE), 1)
  pipe.ingest(chunk(TASK_RESULT_DANGLING), 2)
  await pipe.endTurn('t1')
  const violations = out.filter((e) => e.kind === 'violation')
  expect(violations).toHaveLength(1)
  expect(violations[0]).toMatchObject({
    reason: 'dangling_evidence_ref',
    raw: 'OK (1 test)',
  })
  // The events themselves still emitted — this is a reported violation
  // alongside real output, not a replacement for it (matches fence_drift).
  expect(out.filter((e) => e.kind === 'event')).toHaveLength(2)
})

test('a resolved ref raises no violation at endTurn', async () => {
  const { out, pipe } = collect()
  pipe.beginTurn({ turnId: 't1' })
  pipe.ingest(chunk(LINT_EVIDENCE), 1)
  pipe.ingest(chunk(TASK_RESULT_RESOLVED), 2)
  await pipe.endTurn('t1')
  expect(out.filter((e) => e.kind === 'violation')).toEqual([])
})
