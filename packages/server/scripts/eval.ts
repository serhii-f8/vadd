import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { GATE_THRESHOLD, scoreCorpus } from '../src/evals/score.js'
import { repoRoot } from '../src/paths.js'

/** `--name value`; absent flags fall back to the standard corpus layout. */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  const value = i === -1 ? undefined : process.argv[i + 1]
  if (i !== -1 && (value === undefined || value.startsWith('--'))) {
    throw new Error(`--${name} needs a directory path`)
  }
  return value
}

// `--dir` exists so the two raw no-contract transcripts (design §5.2) can be
// scored as a floor measurement without ever entering the gate's own corpus:
// the scorer reads a directory listing, so separation is by directory, not by
// a flag inside the files.
const transcriptsDir = resolve(flag('dir') ?? join(repoRoot(), 'evals', 'transcripts'))
const labelsDir = resolve(flag('labels') ?? join(repoRoot(), 'evals', 'labels'))

const report = await scoreCorpus({ transcriptsDir, labelsDir })

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  console.log(`Corpus: ${report.extra.transcripts} transcripts from ${transcriptsDir}`)
  console.log(
    `        ${report.extra.tuningTranscripts} tuning, ${report.extra.holdoutTranscripts} holdout\n`,
  )
  console.log('type              labels  matched  precision  recall')
  for (const s of report.byType) {
    console.log(
      `${s.type.padEnd(18)}${String(s.labels).padStart(6)}${String(s.matched).padStart(9)}` +
        `${pct(s.precision).padStart(11)}${pct(s.recall).padStart(8)}`,
    )
  }

  // A subset with no labels tallies to a vacuous recall of 1, which makes the
  // gap meaningless rather than small. Printing a number there would report a
  // guard that was never exercised as a guard that passed.
  const exercised =
    report.extra.tuningTranscripts > 0 &&
    report.extra.holdoutTranscripts > 0 &&
    report.tuning.every((s) => s.labels > 0) &&
    report.holdout.every((s) => s.labels > 0)
  if (exercised) {
    const gap = Math.max(
      ...report.tuning.map((s, i) => Math.abs(s.recall - (report.holdout[i]?.recall ?? s.recall))),
    )
    console.log(
      `\ntuning vs holdout recall gap: ${pct(gap)}` +
        ' (over 10 points means the corpus is too small, not that the gate passed)',
    )
  } else {
    console.log(
      '\ntuning vs holdout recall gap: not measured — the overfitting guard is not' +
        '\n  exercised. Design §5.6 wants four of the ten contract transcripts marked' +
        '\n  "holdout": true, each carrying labels of both gated types.',
    )
  }

  if (report.misses.length > 0) {
    console.log(`\nmissed labels (${report.misses.length}) — each is a prompt or pipeline defect:`)
    for (const m of report.misses) {
      console.log(`  ${m.transcript}  turn ${m.turn}  ${m.type.padEnd(15)} ${m.key}`)
    }
  }
  if (report.falsePositives.length > 0) {
    console.log(
      `\nunlabelled emissions (${report.falsePositives.length}) — counted against precision:`,
    )
    for (const f of report.falsePositives) {
      console.log(`  ${f.transcript}  turn ${f.turn}  ${f.type.padEnd(15)} ${f.headline ?? ''}`)
    }
  }

  const repairPct =
    report.extra.totalTurns === 0 ? 0 : report.extra.repairedTurns / report.extra.totalTurns
  console.log(
    `\nreported, not gated: ${report.extra.parseFailures} parse failures, ` +
      `${report.extra.contractViolations} contract violations, ` +
      `${report.extra.fenceDrifts} fence drifts, ` +
      `${report.extra.unexpectedTypes} out-of-contract emissions, ` +
      `${report.extra.budgetViolations} reading-budget violations,` +
      `\n  ${report.extra.repairedTurns}/${report.extra.totalTurns} turns repaired (${pct(repairPct)})`,
  )

  const scoringCommit = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: repoRoot(),
        encoding: 'utf8',
      }).trim()
    } catch {
      return 'unknown'
    }
  })()
  const stamps = report.extra.recordedUnder
  if (stamps.length === 0) {
    console.log(`\nscoring under ${scoringCommit}; transcripts carry no provenance stamp`)
  } else if (stamps.length > 1 || stamps[0] !== scoringCommit) {
    console.log(
      `\nscoring under ${scoringCommit}; transcripts recorded under ${stamps.join(', ')}.` +
        '\n  Replay derives every emission under the scoring commit, so this is' +
        '\n  expected after a pipeline fix — not a defect, and never gated.',
    )
  }

  console.log(`\nGate (>= ${pct(report.gate.threshold)}): ${report.gate.pass ? 'PASS' : 'FAIL'}`)

  // A bare FAIL next to a table of high percentages reads as a bug in the tool.
  // Say which condition was unmet, so "the corpus is not there yet" is never
  // mistaken for "the agent scored badly", and vice versa.
  if (!report.gate.pass) {
    const reasons: string[] = []
    if (report.extra.transcripts === 0) reasons.push(`no transcripts in ${transcriptsDir}`)
    if (report.extra.transcripts > 0 && report.extra.tuningTranscripts === 0) {
      reasons.push('every transcript is marked holdout — nothing left to tune on')
    }
    if (report.extra.transcripts > 0 && report.extra.holdoutTranscripts === 0) {
      reasons.push('no transcript is marked "holdout": true (design §5.6)')
    }
    for (const s of report.byType) {
      if (s.labels === 0) reasons.push(`no ${s.type} labels anywhere in the corpus`)
      else if (s.precision < GATE_THRESHOLD || s.recall < GATE_THRESHOLD) {
        reasons.push(`${s.type} is below ${pct(GATE_THRESHOLD)}`)
      }
    }
    for (const r of reasons) console.log(`  - ${r}`)
  }
}

// Not process.exit(): that can truncate the report above when stdout is a
// pipe, which is how a human running this to make the kill-switch call will
// invoke it. Setting exitCode lets the process end naturally once stdout drains.
process.exitCode = report.gate.pass ? 0 : 1
