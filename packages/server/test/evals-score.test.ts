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
  expect(report.extra).toHaveProperty('parseFailures')
  expect(report.extra).toHaveProperty('contractViolations')
  expect(report.extra).toHaveProperty('budgetViolations')
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
