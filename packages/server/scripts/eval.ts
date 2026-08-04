import { join } from 'node:path'
import { scoreCorpus } from '../src/evals/score.js'
import { repoRoot } from '../src/paths.js'

const report = await scoreCorpus({
  transcriptsDir: join(repoRoot(), 'evals', 'transcripts'),
  labelsDir: join(repoRoot(), 'evals', 'labels'),
})

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  console.log(`Corpus: ${report.extra.transcripts} transcripts\n`)
  console.log('type              labels  matched  precision  recall')
  for (const s of report.byType) {
    console.log(
      `${s.type.padEnd(18)}${String(s.labels).padStart(6)}${String(s.matched).padStart(9)}` +
        `${pct(s.precision).padStart(11)}${pct(s.recall).padStart(8)}`,
    )
  }
  const gap = (a: typeof report.tuning, b: typeof report.holdout) =>
    Math.max(...a.map((s, i) => Math.abs(s.recall - (b[i]?.recall ?? s.recall))))
  console.log(
    `\ntuning vs holdout recall gap: ${pct(gap(report.tuning, report.holdout))}` +
      ' (over 10 points means the corpus is too small, not that the gate passed)',
  )
  console.log(
    `\nreported, not gated: ${report.extra.parseFailures} parse failures, ` +
      `${report.extra.contractViolations} contract violations, ` +
      `${report.extra.budgetViolations} reading-budget violations`,
  )
  console.log(`\nGate (>= ${pct(report.gate.threshold)}): ${report.gate.pass ? 'PASS' : 'FAIL'}`)
}

// Not process.exit(): that can truncate the report above when stdout is a
// pipe, which is how a human running this to make the kill-switch call will
// invoke it. Setting exitCode lets the process end naturally once stdout drains.
process.exitCode = report.gate.pass ? 0 : 1
