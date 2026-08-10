import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vitest'
import { GATE_THRESHOLD, scoreCorpus } from '../src/evals/score.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'evals')

/**
 * A writable copy of the `tiny` corpus, so a test can delete a transcript or
 * bend a label without editing the shared fixture.
 */
function corpusCopy(): { transcriptsDir: string; labelsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'vadd-evals-copy-'))
  const transcriptsDir = join(root, 'transcripts')
  const labelsDir = join(root, 'labels')
  for (const dir of [transcriptsDir, labelsDir]) mkdirSync(dir)
  copyFileSync(join(fixtures, 'transcripts', 'tiny.jsonl'), join(transcriptsDir, 'tiny.jsonl'))
  copyFileSync(join(fixtures, 'labels', 'tiny.labels.json'), join(labelsDir, 'tiny.labels.json'))
  return { transcriptsDir, labelsDir }
}

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
  // Both directories empty. Pointing an empty transcripts dir at a *populated*
  // labels dir is a different situation — every transcript deleted — and the
  // orphan-label check below is what must fire there.
  const report = await scoreCorpus({
    transcriptsDir: mkdtempSync(join(tmpdir(), 'vadd-evals-empty-tx-')),
    labelsDir: mkdtempSync(join(tmpdir(), 'vadd-evals-empty-lb-')),
  })
  expect(report.extra.transcripts).toBe(0)
  expect(report.gate.pass).toBe(false)
})

test('a transcript with no label file is an error, not a silent skip', async () => {
  await expect(
    scoreCorpus({ transcriptsDir: join(fixtures, 'transcripts'), labelsDir: fixtures }),
  ).rejects.toThrow(/label/i)
})

test('an orphan label file is an error — deleting a bad transcript must not raise the score', async () => {
  // The exact attack the check exists for: score the corpus, notice the agent
  // did badly on one transcript, delete the transcript, leave its labels. Every
  // count the gate reads is computed from the *transcript* listing, so recall
  // rises and nothing in the output says a file went missing.
  const { transcriptsDir, labelsDir } = corpusCopy()
  copyFileSync(join(labelsDir, 'tiny.labels.json'), join(labelsDir, 'deleted-one.labels.json'))

  await expect(scoreCorpus({ transcriptsDir, labelsDir })).rejects.toThrow(
    /deleted-one\.labels\.json/,
  )
})

test('a label pointing at a turn the transcript does not have is an error, not a miss', async () => {
  // Turn numbers are 1-based and written by hand. An off-by-one, or a stale
  // number after re-exporting, silently becomes a missed label — a lie in the
  // *fail* direction, which would kill the project on a labelling typo.
  const { transcriptsDir, labelsDir } = corpusCopy()
  const file = join(labelsDir, 'tiny.labels.json')
  const labels = JSON.parse(readFileSync(file, 'utf8')) as {
    labels: { turn: number; key: string }[]
  }
  const target = labels.labels[0]
  if (target) target.turn = 99
  writeFileSync(file, JSON.stringify(labels))

  await expect(scoreCorpus({ transcriptsDir, labelsDir })).rejects.toThrow(/turn 99/)
  // Naming the label is the point: "some label is wrong" is not actionable
  // against a hand-written corpus of twelve files.
  await expect(scoreCorpus({ transcriptsDir, labelsDir })).rejects.toThrow(/phpunit/)
})

test('turn 0 is rejected too — the range is 1-based at both ends', async () => {
  const { transcriptsDir, labelsDir } = corpusCopy()
  const file = join(labelsDir, 'tiny.labels.json')
  const labels = JSON.parse(readFileSync(file, 'utf8')) as { labels: { turn: number }[] }
  // 0 is written past the schema, which also rejects it (turn is a positive
  // int). Either layer may be the one that fires; what must not happen is a
  // turn-0 label loading and scoring as an honest miss.
  writeFileSync(file, JSON.stringify(labels).replace('"turn":1', '"turn":0'))
  await expect(scoreCorpus({ transcriptsDir, labelsDir })).rejects.toThrow(/turn/i)
})

test('names every missed label and every unlabelled emission', async () => {
  // Without these, `recall 50.0%` is the entire output and a human tuning the
  // prompt has to write their own script to find out which expectation moved
  // — which is exactly what design §5.3 says `key` exists to avoid.
  const report = await scoreCorpus({
    transcriptsDir: join(fixtures, 'transcripts'),
    labelsDir: join(fixtures, 'labels'),
  })
  expect(report.misses).toEqual([
    { transcript: 'tiny', key: 'queue-vs-sync', turn: 2, type: 'decision_needed' },
  ])
  expect(report.falsePositives).toHaveLength(1)
  expect(report.falsePositives[0]).toMatchObject({ transcript: 'tiny', type: 'decision_needed' })
  // The headline is what makes the line readable; decision_needed carries its
  // text in `question`, not `headline`.
  expect(report.falsePositives[0]?.headline).toBeTruthy()
})

test('counts the tuning and holdout subsets, and an empty holdout fails the gate', async () => {
  // tally() scores an empty denominator as 1, so with no holdout both subsets
  // report recall 1.0 and tuning.recall equals byType.recall — the design §5.6
  // gap is then arithmetically incapable of exceeding 10 points whenever the
  // gate passes. The alarm could never fire in the case it exists for.
  const { transcriptsDir, labelsDir } = corpusCopy()
  const report = await scoreCorpus({ transcriptsDir, labelsDir })
  expect(report.extra).toMatchObject({
    transcripts: 1,
    tuningTranscripts: 1,
    holdoutTranscripts: 0,
  })
  expect(report.holdout.every((s) => s.labels === 0 && s.recall === 1)).toBe(true)
  expect(report.gate.pass).toBe(false)
})

test('a corpus that is all holdout also fails — the tuning subset must be real too', async () => {
  const { transcriptsDir, labelsDir } = corpusCopy()
  const file = join(labelsDir, 'tiny.labels.json')
  writeFileSync(file, readFileSync(file, 'utf8').replace('"holdout": false', '"holdout": true'))
  const report = await scoreCorpus({ transcriptsDir, labelsDir })
  expect(report.extra).toMatchObject({ tuningTranscripts: 0, holdoutTranscripts: 1 })
  expect(report.gate.pass).toBe(false)
})

test('a missing labels directory is not a crash', async () => {
  // `evals/labels/` may not exist yet, and the orphan check lists it. An
  // ENOENT stack trace instead of "no transcripts" would read as a broken tool.
  const { transcriptsDir, labelsDir } = corpusCopy()
  rmSync(join(transcriptsDir, 'tiny.jsonl'))
  rmSync(labelsDir, { recursive: true })
  const report = await scoreCorpus({ transcriptsDir, labelsDir })
  expect(report.extra.transcripts).toBe(0)
  expect(report.gate.pass).toBe(false)
})

test('repair rate and provenance are reported and never gate', async () => {
  const { transcriptsDir, labelsDir } = corpusCopy()
  const file = join(transcriptsDir, 'tiny.jsonl')

  // Stamp every record, and mark the first turn repaired by inserting a
  // repair_prompt_sent after its prompt_sent.
  const rows = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
  const stamped: Record<string, unknown>[] = rows.map((r) => ({ ...r, recordedUnder: 'abc1234' }))
  const firstSent = stamped.findIndex((r) => r.type === 'prompt_sent')
  stamped.splice(firstSent + 1, 0, {
    ...stamped[firstSent],
    id: -1,
    type: 'repair_prompt_sent',
    payload: { missing: 'evidence' },
  })
  writeFileSync(file, `${stamped.map((r) => JSON.stringify(r)).join('\n')}\n`)

  const report = await scoreCorpus({ transcriptsDir, labelsDir })

  expect(report.extra.repairedTurns).toBe(1)
  expect(report.extra.totalTurns).toBeGreaterThanOrEqual(1)
  expect(report.extra.recordedUnder).toEqual(['abc1234'])
  // The inserted repair changed no emission, so the score is untouched: repair
  // rate and provenance are reported, never gated.
  const baseline = await scoreCorpus(corpusCopy())
  expect(report.gate.pass).toBe(baseline.gate.pass)
  expect(report.byType.map((s) => s.matched)).toEqual(baseline.byType.map((s) => s.matched))
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
