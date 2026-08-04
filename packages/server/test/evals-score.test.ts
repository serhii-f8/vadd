import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vitest'
import { GATE_THRESHOLD, scoreCorpus } from '../src/evals/score.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'evals')

test('scores recall and precision per gated type', async () => {
  const report = await scoreCorpus({
    transcriptsDir: join(fixtures, 'transcripts'),
    labelsDir: join(fixtures, 'labels'),
  })

  const evidence = report.byType.find((t) => t.type === 'evidence')
  expect(evidence).toMatchObject({ labels: 1, matched: 1, recall: 1, precision: 1 })

  // The decision the agent never emitted is a miss — the gate's whole point.
  const decision = report.byType.find((t) => t.type === 'decision_needed')
  expect(decision).toMatchObject({ labels: 1, matched: 0, recall: 0 })

  expect(report.gate.pass).toBe(false)
  expect(report.gate.threshold).toBe(GATE_THRESHOLD)
})

test('reports parse failures and budget violations without gating on them', async () => {
  const report = await scoreCorpus({
    transcriptsDir: join(fixtures, 'transcripts'),
    labelsDir: join(fixtures, 'labels'),
  })
  // Turn 3 in the fixture carries exactly one malformed fence (a parse
  // failure, which is also a contract violation) and one otherwise-valid
  // status event whose headline blows the Level 1 reading budget.
  expect(report.extra.parseFailures).toBe(1)
  expect(report.extra.contractViolations).toBe(1)
  expect(report.extra.budgetViolations).toBe(1)
  // These are reported, not gated — the gate's verdict is still driven only
  // by the missed decision_needed label, unaffected by counting them.
  expect(report.gate.pass).toBe(false)
})

test('an unlabelled decision_needed emission is a false positive that drags precision below 1', async () => {
  const report = await scoreCorpus({
    transcriptsDir: join(fixtures, 'transcripts'),
    labelsDir: join(fixtures, 'labels'),
  })
  // Turn 4 in the fixture emits a valid decision_needed with no matching
  // label anywhere in the file — matchEmissions counts it as a false
  // positive, and emissions = matched + falsePositives must show it.
  const decision = report.byType.find((t) => t.type === 'decision_needed')
  expect(decision).toMatchObject({ matched: 0, falsePositives: 1, emissions: 1, precision: 0 })
  expect(decision?.precision).toBeLessThan(1)
})

test('an empty transcripts directory fails the gate rather than passing vacuously', async () => {
  const emptyTranscripts = mkdtempSync(join(tmpdir(), 'vadd-evals-empty-'))
  const report = await scoreCorpus({
    transcriptsDir: emptyTranscripts,
    labelsDir: join(fixtures, 'labels'),
  })
  expect(report.extra.transcripts).toBe(0)
  expect(report.gate.pass).toBe(false)
})

test('a transcript with no label file is an error, not a silent skip', async () => {
  await expect(
    scoreCorpus({ transcriptsDir: join(fixtures, 'transcripts'), labelsDir: fixtures }),
  ).rejects.toThrow(/label/i)
})

test('runs offline — no summarizer is constructed', async () => {
  const spy = vi.spyOn(globalThis, 'fetch')
  await scoreCorpus({
    transcriptsDir: join(fixtures, 'transcripts'),
    labelsDir: join(fixtures, 'labels'),
  })
  expect(spy).not.toHaveBeenCalled()
  spy.mockRestore()
})
