import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { type AgentEvent, fitsReadingBudget } from '@vadd/core'
import { type ContractEmission, ContractPipeline } from '../contract/pipeline.js'
import { GATED_TYPES, type GatedType, loadLabelFile } from './labels.js'
import { matchEmissions } from './match.js'
import { loadTranscript } from './transcript.js'

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

export type EvalReport = {
  gate: { pass: boolean; threshold: number }
  byType: TypeScore[]
  tuning: TypeScore[]
  holdout: TypeScore[]
  extra: {
    transcripts: number
    parseFailures: number
    contractViolations: number
    budgetViolations: number
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
}> {
  const { turns } = loadTranscript(file)
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

  return { byTurn, emissions }
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

export async function scoreCorpus(opts: {
  transcriptsDir: string
  labelsDir: string
}): Promise<EvalReport> {
  const files = readdirSync(opts.transcriptsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
  const all: (TypeScore & { holdout: boolean })[] = []
  const extra = { transcripts: 0, parseFailures: 0, contractViolations: 0, budgetViolations: 0 }

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
    const { byTurn, emissions } = await replayTranscript(join(opts.transcriptsDir, file))
    const result = matchEmissions(labels.labels, byTurn)

    extra.transcripts += 1
    for (const e of emissions) {
      if (e.kind === 'violation') {
        extra.contractViolations += 1
        if (e.reason === 'parse') extra.parseFailures += 1
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
        precision: 0,
        recall: 0,
        holdout: labels.holdout,
      })
    }
  }

  const byType = tally(all)
  const pass = byType.every((s) => s.precision >= GATE_THRESHOLD && s.recall >= GATE_THRESHOLD)
  return {
    gate: { pass, threshold: GATE_THRESHOLD },
    byType,
    tuning: tally(all.filter((r) => !r.holdout)),
    holdout: tally(all.filter((r) => r.holdout)),
    extra,
  }
}
