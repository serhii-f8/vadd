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

test('a leading (?i) makes the regex match regardless of case', () => {
  const caseInsensitive = LabelFile.parse({
    schemaVersion: 1,
    transcript: 't',
    labels: [{ turn: 1, type: 'evidence', key: 'ci', match: { headline: '(?i)\\d+ TESTS?' } }],
  })
  // The pattern is uppercase, the emission is lowercase: this only matches if
  // the `i` flag is actually applied, not merely accepted at parse time.
  const r = matchEmissions(caseInsensitive.labels, new Map([[1, [evidence('OK (12 tests)')]]]))
  expect(r.matched).toHaveLength(1)
})

test('a non-leading (?i) is unsupported and rejected at load time, not silently mishandled', () => {
  expect(() =>
    LabelFile.parse({
      schemaVersion: 1,
      transcript: 't',
      labels: [{ turn: 1, type: 'evidence', key: 'k', match: { headline: 'foo(?i)bar' } }],
    }),
  ).toThrow()
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

test('rejects a kind/status value outside the schema enum instead of never matching it', () => {
  // `kind` and `status` compare exactly, but every other match value is a
  // regex — so a labeller reaching for regex syntax, or simply typing the
  // wrong word, used to get a file that loaded clean and scored zero. The
  // failure was indistinguishable from the agent not emitting the block.
  for (const bad of [{ status: '(?i)pass' }, { status: 'passed' }, { kind: 'tests' }]) {
    expect(
      () =>
        LabelFile.parse({
          schemaVersion: 1,
          transcript: 't',
          labels: [{ turn: 1, type: 'evidence', key: 'k', match: bad }],
        }),
      JSON.stringify(bad),
    ).toThrow(/exactly|not one of/i)
  }
})

test('accepts every legal kind and status value', () => {
  // The rejection above must not be over-broad: a check that refused a valid
  // value would block labelling entirely, and the corpus is hand-written.
  for (const kind of ['test', 'diff', 'lint', 'build', 'check', 'artifact', 'warning']) {
    for (const status of ['pass', 'fail', 'warn', 'info']) {
      const file = LabelFile.parse({
        schemaVersion: 1,
        transcript: 't',
        labels: [{ turn: 1, type: 'evidence', key: 'k', match: { kind, status } }],
      })
      expect(file.labels).toHaveLength(1)
    }
  }
})

test('leaves a non-evidence label alone — an absent field fails to match, it does not throw', () => {
  // Design §5.3: a label naming a field the event does not carry simply fails
  // to match. Only `evidence` carries kind/status, so the enum check must not
  // reach across to other types.
  const file = LabelFile.parse({
    schemaVersion: 1,
    transcript: 't',
    labels: [{ turn: 1, type: 'decision_needed', key: 'k', match: { status: 'anything at all' } }],
  })
  const r = matchEmissions(file.labels, new Map([[1, [evidence('OK (12 tests)')]]]))
  expect(r.matched).toEqual([])
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
