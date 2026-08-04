import type { AgentEvent } from '@vadd/core'
import { expect, test } from 'vitest'
import { LabelFile } from '../src/evals/labels.js'
import { matchEmissions } from '../src/evals/match.js'

const evidence = (headline: string, status: 'pass' | 'fail' = 'pass'): AgentEvent => ({
  type: 'evidence',
  kind: 'test',
  status,
  headline,
  summary: [],
})

const labels = LabelFile.parse({
  schemaVersion: 1,
  transcript: 't',
  labels: [
    {
      turn: 1,
      type: 'evidence',
      key: 'phpunit',
      match: { kind: 'test', status: 'pass', headline: '(?i)\\d+ tests?' },
    },
  ],
})

test('matches on exact kind/status and a headline regex', () => {
  const r = matchEmissions(labels.labels, new Map([[1, [evidence('OK (12 tests)')]]]))
  expect(r.matched).toHaveLength(1)
  expect(r.missed).toEqual([])
  expect(r.falsePositives).toEqual([])
})

test('a status mismatch is a miss and a false positive, not a match', () => {
  const r = matchEmissions(labels.labels, new Map([[1, [evidence('OK (12 tests)', 'fail')]]]))
  expect(r.matched).toEqual([])
  expect(r.missed).toHaveLength(1)
  expect(r.falsePositives).toHaveLength(1)
})

test('an emission in the wrong turn does not match', () => {
  const r = matchEmissions(labels.labels, new Map([[2, [evidence('OK (12 tests)')]]]))
  expect(r.matched).toEqual([])
  expect(r.missed).toHaveLength(1)
  expect(r.falsePositives).toHaveLength(1)
})

test('the earliest candidate wins and a duplicate counts as a false positive', () => {
  const r = matchEmissions(
    labels.labels,
    new Map([[1, [evidence('OK (12 tests)'), evidence('OK (13 tests)')]]]),
  )
  expect(r.matched).toHaveLength(1)
  expect((r.matched[0]?.event as { headline: string } | undefined)?.headline).toBe('OK (12 tests)')
  // A second decision card for one decision is a real defect, not a rounding error.
  expect(r.falsePositives).toHaveLength(1)
})

test('ignores emissions of non-gated types entirely', () => {
  const status: AgentEvent = { type: 'status', phase: 'executing', headline: 'x' }
  const r = matchEmissions(labels.labels, new Map([[1, [status, evidence('OK (12 tests)')]]]))
  expect(r.matched).toHaveLength(1)
  expect(r.falsePositives).toEqual([])
})

test('rejects a label file with an unparseable regex', () => {
  expect(() =>
    LabelFile.parse({
      schemaVersion: 1,
      transcript: 't',
      labels: [{ turn: 1, type: 'evidence', key: 'k', match: { headline: '(' } }],
    }),
  ).toThrow()
})

test('rejects duplicate keys within a transcript', () => {
  expect(() =>
    LabelFile.parse({
      schemaVersion: 1,
      transcript: 't',
      labels: [
        { turn: 1, type: 'evidence', key: 'k', match: {} },
        { turn: 2, type: 'evidence', key: 'k', match: {} },
      ],
    }),
  ).toThrow(/key/i)
})
