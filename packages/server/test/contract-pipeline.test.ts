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
  pipe.beginTurn({ turnId: 't1', expect: ['plan'] })
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
  pipe.beginTurn({ turnId: 't1', expect: ['status'] })
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
