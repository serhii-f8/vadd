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
