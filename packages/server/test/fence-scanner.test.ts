import { expect, test } from 'vitest'
import { FenceScanner } from '../src/contract/fence-scanner.js'

test('extracts a block that arrives in one chunk', () => {
  const s = new FenceScanner()
  const blocks = s.push('before\n```vadd-event\n{"type":"status"}\n```\nafter\n')
  expect(blocks).toEqual([{ body: '{"type":"status"}' }])
})

test('extracts a block split across arbitrary chunk boundaries', () => {
  const s = new FenceScanner()
  const whole = '```vadd-event\n{"a":1,\n "b":2}\n```\n'
  const out = []
  for (const ch of whole) out.push(...s.push(ch)) // one character at a time
  expect(out).toEqual([{ body: '{"a":1,\n "b":2}' }])
})

test('extracts several blocks from one stream', () => {
  const s = new FenceScanner()
  const blocks = s.push('```vadd-event\nA\n```\ntext\n```vadd-event\nB\n```\n')
  expect(blocks).toEqual([{ body: 'A' }, { body: 'B' }])
})

test('ignores fences with another language tag', () => {
  const s = new FenceScanner()
  expect(s.push('```json\n{"not":"ours"}\n```\n')).toEqual([])
})

test('reports an unterminated fence on flush', () => {
  const s = new FenceScanner()
  s.push('```vadd-event\n{"half":true}\n')
  expect(s.flush()).toEqual({ blocks: [], unterminated: '{"half":true}' })
})

test('closes a block whose final line has no trailing newline', () => {
  const s = new FenceScanner()
  expect(s.push('```vadd-event\nX\n```')).toEqual([])
  expect(s.flush()).toEqual({ blocks: [{ body: 'X' }], unterminated: null })
})

test('tolerates indented fences', () => {
  const s = new FenceScanner()
  expect(s.push('  ```vadd-event\n  {"i":1}\n  ```\n')).toEqual([{ body: '  {"i":1}' }])
})

test('resets cleanly so one scanner can serve consecutive turns', () => {
  const s = new FenceScanner()
  s.push('```vadd-event\ndangling\n')
  s.flush()
  expect(s.push('```vadd-event\nfresh\n```\n')).toEqual([{ body: 'fresh' }])
})

// Observed live on 2026-08-09, and the likely cause of the corpus's five
// `unterminated` violations. The adapter concatenates separate assistant
// messages with no separator, so a closing fence arrives welded to the prose
// that followed it ("```Dependencies aren't installed."). Requiring a closing
// fence to be alone on its line then swallowed the rest of the turn — including
// a complete, valid `evidence` block — into one unparseable body.
test('closes a block whose closing fence is welded to the following prose', () => {
  const s = new FenceScanner()
  const blocks = s.push(
    '```vadd-event\n{"type":"status"}\n```Dependencies are missing. Installing them.\n',
  )
  expect(blocks).toEqual([
    {
      body: '{"type":"status"}',
      weldedRemainder: 'Dependencies are missing. Installing them.',
    },
  ])
})

test('still finds a later block after a welded closing fence', () => {
  const s = new FenceScanner()
  const blocks = s.push('```vadd-event\n{"a":1}\n```Prose ran on.\n\n```vadd-event\n{"b":2}\n```\n')
  expect(blocks).toEqual([
    { body: '{"a":1}', weldedRemainder: 'Prose ran on.' },
    { body: '{"b":2}' },
  ])
})

test('leaves no block open after a welded closing fence', () => {
  const s = new FenceScanner()
  s.push('```vadd-event\n{"type":"status"}\n```and then prose\n')
  expect(s.flush().unterminated).toBeNull()
})

test('a drift close reports the welded remainder', () => {
  const scanner = new FenceScanner()
  const blocks = scanner.push('```vadd-event\n{"type":"status"}\n```Now let me check the config\n')
  expect(blocks).toHaveLength(1)
  expect(blocks[0]?.body).toBe('{"type":"status"}')
  expect(blocks[0]?.weldedRemainder).toBe('Now let me check the config')
})

test('a clean close leaves weldedRemainder unset', () => {
  const scanner = new FenceScanner()
  const blocks = scanner.push('```vadd-event\n{"type":"status"}\n```\n')
  expect(blocks).toHaveLength(1)
  expect(blocks[0]?.weldedRemainder).toBeUndefined()
})

test('a CRLF drift close leaves no stray carriage return', () => {
  const scanner = new FenceScanner()
  const blocks = scanner.push('```vadd-event\r\n{"type":"status"}\r\n```trailing\r\n')
  expect(blocks[0]?.weldedRemainder).toBe('trailing')
})

test('recovers an opening fence welded to the preceding prose', () => {
  // health-ready-disclosure (phase 2b) and operator-change-log twice in one
  // verify turn (phase 2c). Total silence before this: no block, no
  // weldedRemainder, no unterminated body, no violation — a direct breach of
  // the pipeline's "never drop silently" rule, and it cost a gated label.
  const s = new FenceScanner()
  const blocks = [
    ...s.push('Let me fix it and re-run.```vadd-event\n{"type":"status"}\n```\n'),
    ...s.flush().blocks,
  ]
  expect(blocks).toHaveLength(1)
  expect(blocks[0]?.body).toBe('{"type":"status"}')
})

test('recovers an opening whose tag sits on the line after the backticks', () => {
  // error-tracking-wiring turn 3: ``` then vadd-event then the JSON. Swallowed
  // an honest failure event whole.
  const s = new FenceScanner()
  const blocks = [...s.push('```\nvadd-event\n{"type":"status"}\n```\n'), ...s.flush().blocks]
  expect(blocks).toHaveLength(1)
  expect(blocks[0]?.body).toBe('{"type":"status"}')
})

test('reports a welded opening as drift so it is never silent', () => {
  const s = new FenceScanner()
  const blocks = [...s.push('Prose.```vadd-event\n{"a":1}\n```\n'), ...s.flush().blocks]
  expect(blocks[0]?.weldedRemainder).toBe('Prose.')
})

test('recovers two welded openings in one turn', () => {
  // operator-change-log's verify turn hit the same pattern twice, the second
  // carrying a top-level array the pipeline already supports.
  const s = new FenceScanner()
  const blocks = [
    ...s.push('First.```vadd-event\n{"a":1}\n```\nThen.```vadd-event\n[{"b":2},{"c":3}]\n```\n'),
    ...s.flush().blocks,
  ]
  expect(blocks.map((b) => b.body)).toEqual(['{"a":1}', '[{"b":2},{"c":3}]'])
})

test('a plain code fence is still not a vadd-event block', () => {
  const s = new FenceScanner()
  const blocks = [...s.push('```json\n{"a":1}\n```\n'), ...s.flush().blocks]
  expect(blocks).toEqual([])
})

test('a bare fence not followed by the tag stays an ordinary code fence', () => {
  const s = new FenceScanner()
  const blocks = [...s.push('```\nconst x = 1\n```\n'), ...s.flush().blocks]
  expect(blocks).toEqual([])
})

test('prose merely mentioning the tag does not open a block', () => {
  const s = new FenceScanner()
  const blocks = [...s.push('Use the vadd-event fence tag.\n'), ...s.flush().blocks]
  expect(blocks).toEqual([])
})

test('a welded opening split across chunk boundaries still opens', () => {
  // ACP splits chunks at arbitrary points, sometimes mid-word — the reason the
  // scanner buffers by line rather than by chunk.
  const s = new FenceScanner()
  const blocks = [
    ...s.push('Done.```vadd-e'),
    ...s.push('vent\n{"a":1}\n'),
    ...s.push('```\n'),
    ...s.flush().blocks,
  ]
  expect(blocks.map((b) => b.body)).toEqual(['{"a":1}'])
})
