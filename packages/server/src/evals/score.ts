import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { type AgentEvent, fitsReadingBudget } from '@vadd/core'
import { type ContractEmission, ContractPipeline } from '../contract/pipeline.js'
import { GATED_TYPES, type GatedType, loadLabelFile } from './labels.js'
import { matchEmissions } from './match.js'
import { loadTranscript, type TranscriptTurn } from './transcript.js'

/** Spec §9: ≥90% precision and recall on the two gated types. */
export const GATE_THRESHOLD = 0.9

export type TypeScore = {
  type: GatedType
  labels: number
  emissions: number
  matched: number
  falsePositives: number
  precision: number
  recall: number
}

/** A label that should have surfaced and did not, named so it can be read. */
export type EvalMiss = { transcript: string; key: string; turn: number; type: GatedType }

/** A gated emission no label accounted for. */
export type EvalFalsePositive = {
  transcript: string
  turn: number
  type: GatedType
  /** `headline` for `evidence`, `question` for `decision_needed`. */
  headline?: string
}

export type EvalReport = {
  gate: { pass: boolean; threshold: number }
  byType: TypeScore[]
  tuning: TypeScore[]
  holdout: TypeScore[]
  /**
   * Per-label detail. Design §5.3 justifies `key` as existing "so a diff of
   * eval output names which expectation moved"; without these two lists the
   * only output is an aggregate percentage, and phase 2's entire activity is
   * iterating against that number.
   */
  misses: EvalMiss[]
  falsePositives: EvalFalsePositive[]
  extra: {
    transcripts: number
    /** Transcripts whose label file says `holdout: false` / omits it. */
    tuningTranscripts: number
    /** Transcripts whose label file says `holdout: true` (design §5.6). */
    holdoutTranscripts: number
    parseFailures: number
    contractViolations: number
    budgetViolations: number
    repairedTurns: number
    totalTurns: number
    fenceDrifts: number
    recordedUnder: string[]
  }
}

/**
 * Replays a recorded transcript through the production pipeline.
 *
 * The summarizer is deliberately absent: the gate binds on the shipped default
 * configuration, so CI stays offline, deterministic, and free, and a failing
 * gate cannot be masked by paying for a rescue (design §5.5).
 */
export async function replayTranscript(file: string): Promise<{
  byTurn: Map<number, AgentEvent[]>
  emissions: ContractEmission[]
  turns: TranscriptTurn[]
  recordedUnder: string[]
}> {
  const { turns, recordedUnder } = loadTranscript(file)
  const byTurn = new Map<number, AgentEvent[]>()
  const emissions: ContractEmission[] = []

  for (const turn of turns) {
    const events: AgentEvent[] = []
    const pipe = new ContractPipeline({
      onEmit: (e) => {
        emissions.push(e)
        if (e.kind === 'event') events.push(e.event)
      },
    })
    const turnId = `turn-${turn.index}`
    pipe.beginTurn({ turnId })
    for (const update of turn.updates) pipe.ingest(update)
    await pipe.endTurn(turnId)
    byTurn.set(turn.index, events)
  }

  return { byTurn, emissions, turns, recordedUnder }
}

type Row = {
  type: GatedType
  matched: number
  labels: number
  emissions: number
  falsePositives: number
}

function tally(rows: Row[]): TypeScore[] {
  return GATED_TYPES.map((type) => {
    const mine = rows.filter((r) => r.type === type)
    const matched = mine.reduce((s, r) => s + r.matched, 0)
    const labels = mine.reduce((s, r) => s + r.labels, 0)
    const emissions = mine.reduce((s, r) => s + r.emissions, 0)
    const falsePositives = mine.reduce((s, r) => s + r.falsePositives, 0)
    return {
      type,
      labels,
      emissions,
      matched,
      falsePositives,
      // An empty denominator scores 1: nothing was asked for and nothing was
      // wrongly produced. Callers read `labels` to see whether that is real.
      precision: emissions === 0 ? 1 : matched / emissions,
      recall: labels === 0 ? 1 : matched / labels,
    }
  })
}

/** Whatever the emission puts on screen, for a readable false-positive line. */
function headlineOf(event: AgentEvent): string | undefined {
  if ('headline' in event) return event.headline
  if ('question' in event) return event.question
  return undefined
}

export async function scoreCorpus(opts: {
  transcriptsDir: string
  labelsDir: string
}): Promise<EvalReport> {
  const files = readdirSync(opts.transcriptsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
  const all: (Row & { holdout: boolean })[] = []
  const misses: EvalMiss[] = []
  const falsePositives: EvalFalsePositive[] = []
  const extra = {
    transcripts: 0,
    tuningTranscripts: 0,
    holdoutTranscripts: 0,
    parseFailures: 0,
    contractViolations: 0,
    budgetViolations: 0,
    repairedTurns: 0,
    totalTurns: 0,
    fenceDrifts: 0,
    recordedUnder: [] as string[],
  }

  for (const file of files) {
    const name = file.replace(/\.jsonl$/, '')
    const labelFile = join(opts.labelsDir, `${name}.labels.json`)
    if (!existsSync(labelFile)) {
      throw new Error(
        `No label file for transcript "${name}" at ${labelFile}. Every corpus ` +
          'transcript must be labelled; an unlabelled one would silently inflate precision.',
      )
    }
    const labels = loadLabelFile(labelFile)
    const { byTurn, emissions, turns, recordedUnder } = await replayTranscript(
      join(opts.transcriptsDir, file),
    )

    // Turn numbers are assigned by the loader and written by hand, so an
    // off-by-one or a stale number after a re-export is a real possibility.
    // Unchecked it is indistinguishable from the agent never emitting the
    // block — a lie in the *fail* direction, which would kill the project on
    // a labelling typo.
    for (const label of labels.labels) {
      if (label.turn < 1 || label.turn > byTurn.size) {
        throw new Error(
          `${labelFile}: label "${label.key}" points at turn ${label.turn}, but ` +
            `"${name}" has ${byTurn.size} turn(s). Turns are 1-based; a label ` +
            'outside that range can never match and would silently depress recall.',
        )
      }
    }

    const result = matchEmissions(labels.labels, byTurn)
    for (const label of result.missed) {
      misses.push({ transcript: name, key: label.key, turn: label.turn, type: label.type })
    }
    for (const fp of result.falsePositives) {
      falsePositives.push({
        transcript: name,
        turn: fp.turn,
        type: fp.event.type as GatedType,
        headline: headlineOf(fp.event),
      })
    }

    extra.transcripts += 1
    if (labels.holdout) extra.holdoutTranscripts += 1
    else extra.tuningTranscripts += 1
    extra.totalTurns += turns.length
    extra.repairedTurns += turns.filter((t) => t.repaired).length
    for (const stamp of recordedUnder) {
      if (!extra.recordedUnder.includes(stamp)) extra.recordedUnder.push(stamp)
    }
    for (const e of emissions) {
      if (e.kind === 'violation') {
        extra.contractViolations += 1
        if (e.reason === 'parse') extra.parseFailures += 1
        if (e.reason === 'fence_drift') extra.fenceDrifts += 1
      } else {
        extra.budgetViolations += fitsReadingBudget(e.event).length
      }
    }

    for (const type of GATED_TYPES) {
      const labelCount = labels.labels.filter((l) => l.type === type).length
      const matched = result.matched.filter((m) => m.label.type === type).length
      const fp = result.falsePositives.filter((f) => f.event.type === type).length
      all.push({
        type,
        labels: labelCount,
        matched,
        falsePositives: fp,
        emissions: matched + fp,
        holdout: labels.holdout,
      })
    }
  }

  // The mirror of the missing-label check above. Without it, deleting the
  // transcript the agent did worst on and leaving its labels behind raises
  // recall with no visible trace — the highest-leverage remaining way for the
  // gate to report a number it has not earned.
  const present = new Set(files.map((f) => f.replace(/\.jsonl$/, '')))
  const orphans = existsSync(opts.labelsDir)
    ? readdirSync(opts.labelsDir)
        .filter((f) => f.endsWith('.labels.json'))
        .filter((f) => !present.has(f.replace(/\.labels\.json$/, '')))
        .sort()
    : []
  if (orphans.length > 0) {
    throw new Error(
      `No transcript for label file(s) ${orphans.join(', ')} in ${opts.transcriptsDir}. ` +
        'Every label file must have its transcript; an orphan one means a transcript ' +
        'was deleted, which would silently raise recall.',
    )
  }

  const byType = tally(all)
  // The zero-denominator convention in tally() is correct for reporting — a 1.0
  // grounded in zero labels is meaningful once a reader checks `labels`. It is
  // not safe as the gate's own verdict: an empty or mis-pointed corpus (no
  // transcripts, or a type with zero labels across every transcript) must not
  // silently read PASS. `extra.transcripts > 0` and `s.labels > 0` make both
  // holes explicit failures instead of vacuous successes.
  //
  // The tuning/holdout split carries the same vacuity one level down: with no
  // transcript marked `holdout: true`, both subsets tally to recall 1 over zero
  // labels, tuning.recall equals byType.recall, and the design §5.6 gap is
  // arithmetically guaranteed to be ≤10 points whenever the gate passes. The
  // overfitting alarm could therefore never fire in the case it exists for —
  // the human forgot to mark the four holdout files. Requiring both subsets to
  // be non-empty makes that a loud failure instead of a silent PASS.
  const pass =
    extra.transcripts > 0 &&
    extra.tuningTranscripts > 0 &&
    extra.holdoutTranscripts > 0 &&
    byType.every((s) => s.labels > 0 && s.precision >= GATE_THRESHOLD && s.recall >= GATE_THRESHOLD)
  return {
    gate: { pass, threshold: GATE_THRESHOLD },
    byType,
    tuning: tally(all.filter((r) => !r.holdout)),
    holdout: tally(all.filter((r) => r.holdout)),
    misses,
    falsePositives,
    extra,
  }
}
