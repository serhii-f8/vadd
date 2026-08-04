import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, test } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures', 'evals')
const evalScript = join(here, '..', 'scripts', 'eval.ts')

function resolveTsxCli(): string {
  const pkgPath = fileURLToPath(import.meta.resolve('tsx/package.json'))
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string }
  return resolve(dirname(pkgPath), pkg.bin)
}

/** Runs the real CLI as a child process — exit code included. */
function runEval(args: string[]) {
  return execa(process.execPath, [resolveTsxCli(), evalScript, ...args], { reject: false })
}

test('--dir and --labels score a corpus outside the gate directory', async () => {
  // Design §5.2's two raw no-contract transcripts are a floor measurement and
  // must never enter the gate's own number. Membership is a directory listing,
  // so scoring them separately needs this flag; without it the only options
  // were to contaminate the corpus or not measure the floor at all.
  const res = await runEval([
    '--dir',
    join(fixtures, 'transcripts'),
    '--labels',
    join(fixtures, 'labels'),
  ])
  expect(res.stdout).toContain('Corpus: 1 transcripts')
  expect(res.stdout).toContain(join(fixtures, 'transcripts'))
  expect(res.stdout).toMatch(/decision_needed/)
  // The fixture's decision_needed label is deliberately missed, so this run is
  // a real FAIL, not a directory that happened to be empty.
  expect(res.exitCode).toBe(1)
})

test('prints the missed labels by key, not just an aggregate percentage', async () => {
  const res = await runEval([
    '--dir',
    join(fixtures, 'transcripts'),
    '--labels',
    join(fixtures, 'labels'),
  ])
  expect(res.stdout).toContain('missed labels (1)')
  expect(res.stdout).toContain('queue-vs-sync')
  expect(res.stdout).toContain('unlabelled emissions (1)')
})

test('reports the holdout guard as unexercised rather than printing a vacuous gap', async () => {
  // With no transcript marked holdout, both subsets tally recall 1.0 over zero
  // labels and the printed gap was always ≤10 points whenever the gate passed.
  const res = await runEval([
    '--dir',
    join(fixtures, 'transcripts'),
    '--labels',
    join(fixtures, 'labels'),
  ])
  expect(res.stdout).toContain('not measured')
  expect(res.stdout).not.toMatch(/tuning vs holdout recall gap: \d/)
  // And the FAIL says which condition was unmet, so it cannot be read as the
  // agent having scored badly.
  expect(res.stdout).toContain('holdout')
})

test('--json emits the machine-readable report including per-label detail', async () => {
  const res = await runEval([
    '--dir',
    join(fixtures, 'transcripts'),
    '--labels',
    join(fixtures, 'labels'),
    '--json',
  ])
  const report = JSON.parse(res.stdout) as {
    misses: { key: string }[]
    extra: { holdoutTranscripts: number }
  }
  expect(report.misses.map((m) => m.key)).toEqual(['queue-vs-sync'])
  expect(report.extra.holdoutTranscripts).toBe(0)
})

test('a flag with no value is an error, not a silent default', async () => {
  const res = await runEval(['--dir'])
  expect(res.exitCode).not.toBe(0)
  expect(res.stderr).toContain('--dir needs a directory path')
})
