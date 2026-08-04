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
