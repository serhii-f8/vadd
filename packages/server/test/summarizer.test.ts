import type { RawAgentUpdate } from '@vadd/core'
import { agentEventJsonSchema } from '@vadd/core'
import { expect, test, vi } from 'vitest'
import { ContractPipeline } from '../src/contract/pipeline.js'
import { stripUnsupportedKeywords } from '../src/contract/summarizer.js'

function chunk(text: string): RawAgentUpdate {
  return {
    sessionId: 's1',
    receivedAt: '2026-08-04T00:00:00.000Z',
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  }
}

test('strips the JSON Schema keywords structured outputs rejects', () => {
  const stripped = stripUnsupportedKeywords({
    type: 'object',
    properties: {
      headline: { type: 'string', maxLength: 120, minLength: 1 },
      tasks: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } },
      n: { type: 'integer', minimum: 0, maximum: 5 },
    },
  })
  expect(JSON.stringify(stripped)).not.toMatch(
    /maxLength|minLength|minItems|maxItems|minimum|maximum/,
  )
  // Structure survives.
  expect((stripped as { properties: Record<string, unknown> }).properties.headline).toEqual({
    type: 'string',
  })
})

test('the real AgentEvent schema still has content after stripping', () => {
  const stripped = stripUnsupportedKeywords(agentEventJsonSchema()) as Record<string, unknown>
  expect(JSON.stringify(stripped)).toContain('decision_needed')
})

test('a summarizer rescues a turn that emitted no block', async () => {
  const out: unknown[] = []
  const pipe = new ContractPipeline({
    onEmit: (e) => out.push(e),
    summarizer: {
      extract: async () => ({
        events: [{ type: 'plan', tasks: [{ title: 'Fix the bug', description: 'Add a test' }] }],
      }),
    },
  })
  pipe.beginTurn({ turnId: 't1', expect: ['plan'] })
  pipe.ingest(chunk('Here is my plan, in prose: first add a test, then fix the bug.\n'), 1)
  await pipe.endTurn('t1')

  expect(out).toContainEqual(
    expect.objectContaining({
      kind: 'event',
      extracted: true,
      event: { type: 'plan', tasks: [{ title: 'Fix the bug', description: 'Add a test' }] },
    }),
  )
})

test('a summarizer returning junk falls through to the raw-view status', async () => {
  const out: { kind: string }[] = []
  const pipe = new ContractPipeline({
    onEmit: (e) => out.push(e),
    summarizer: { extract: async () => ({ events: [{ type: 'nonsense' }] }) },
  })
  pipe.beginTurn({ turnId: 't1', expect: ['plan'] })
  pipe.ingest(chunk('prose only\n'), 1)
  await pipe.endTurn('t1')
  expect(out.at(-1)).toMatchObject({
    kind: 'event',
    event: { type: 'status', headline: 'Unstructured output — open raw view' },
  })
})

test('a summarizer that throws does not break the turn', async () => {
  const out: { kind: string }[] = []
  const pipe = new ContractPipeline({
    onEmit: (e) => out.push(e),
    summarizer: {
      extract: async () => {
        throw new Error('402 payment required')
      },
    },
  })
  pipe.beginTurn({ turnId: 't1', expect: ['plan'] })
  pipe.ingest(chunk('prose only\n'), 1)
  await expect(pipe.endTurn('t1')).resolves.toBeUndefined()
  expect(out.at(-1)).toMatchObject({ kind: 'event', event: { type: 'status' } })
})

test('makes zero network calls with no summarizer configured', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  const pipe = new ContractPipeline({ onEmit: () => undefined })
  pipe.beginTurn({ turnId: 't1', expect: ['plan', 'evidence'] })
  pipe.ingest(chunk('nothing structured here at all\n'), 1)
  await pipe.endTurn('t1')
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
})
