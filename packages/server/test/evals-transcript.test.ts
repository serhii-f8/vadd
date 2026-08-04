import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { loadTranscript, TRANSCRIPT_SCHEMA_VERSION } from '../src/evals/transcript.js'

function write(lines: unknown[]): string {
  const file = join(mkdtempSync(join(tmpdir(), 'vadd-tx-')), 'sample.jsonl')
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
  return file
}
const chunk = (text: string) => ({
  sessionId: 's',
  receivedAt: '2026-08-04T00:00:00.000Z',
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
})
const row = (id: number, type: string, payload: unknown) => ({
  id,
  objectiveId: 'o1',
  type,
  payload,
  createdAt: '2026-08-04T00:00:00.000Z',
  schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
})

test('groups updates into turns bounded by prompt_sent and its terminal event', () => {
  const file = write([
    row(1, 'prompt_sent', { text: 'go' }),
    row(2, 'agent_update', chunk('a')),
    row(3, 'prompt_finished', { stopReason: 'end_turn' }),
    row(4, 'prompt_sent', { text: 'again' }),
    row(5, 'agent_update', chunk('b')),
    row(6, 'prompt_failed', { message: 'boom' }),
  ])
  const { turns } = loadTranscript(file)
  expect(turns.map((t) => t.index)).toEqual([1, 2])
  expect(turns[0]?.updates).toHaveLength(1)
  expect(turns[1]?.updates).toHaveLength(1)
})

test('refuses a pre-v2 export rather than normalizing it', () => {
  const file = write([{ id: 1, objectiveId: 'o1', type: 'agent_update', payload: chunk('a') }])
  expect(() => loadTranscript(file)).toThrow(/schemaVersion/)
})

test('refuses the M0 spike shape', () => {
  const file = write([{ kind: 'send', at: '...', data: {} }])
  expect(() => loadTranscript(file)).toThrow(/schemaVersion/)
})

test('an unterminated final turn is still returned', () => {
  const file = write([row(1, 'prompt_sent', { text: 'go' }), row(2, 'agent_update', chunk('a'))])
  expect(loadTranscript(file).turns).toHaveLength(1)
})
