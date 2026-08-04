import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { RawAgentUpdate } from '@vadd/core'

/**
 * Bumped to 2 by the M1 export script.
 *
 * Version 1 is everything M0 wrote — including exports taken before the
 * dropped-update fix, which are lossy in exactly the dimension these evals
 * measure (`docs/superpowers/notes/m0-known-gaps.md`). The loader refuses them
 * rather than normalizing: a silently degraded corpus would move the gate
 * without anyone noticing.
 */
export const TRANSCRIPT_SCHEMA_VERSION = 2

export type TranscriptRecord = {
  id: number
  objectiveId: string | null
  type: string
  payload: unknown
  createdAt: string
  schemaVersion: number
}

/** One prompt turn: `index` is 1-based, matching the label files. */
export type TranscriptTurn = { index: number; updates: RawAgentUpdate[] }

/**
 * Records that close a turn, i.e. the points at which the live pipeline's
 * `endTurn` ran. Replay must close the turn wherever production did, or the
 * replayed turn and the live turn contain different updates and the eval score
 * measures something that never happened.
 *
 * `prompt_cancel_requested` is in the set for that reason: the cancel route
 * ends the pipeline's turn immediately, because the adapter may never settle
 * the in-flight prompt. The prompt's own terminal record may still arrive
 * afterwards; closing an already-closed turn is a no-op both here and in the
 * pipeline, and one turn carrying two closing records must not produce a
 * phantom turn.
 */
const TURN_CLOSING = new Set([
  'prompt_finished',
  'prompt_failed',
  'prompt_cancelled',
  'prompt_cancel_requested',
])

export function loadTranscript(file: string): { name: string; turns: TranscriptTurn[] } {
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
  const turns: TranscriptTurn[] = []
  let current: TranscriptTurn | null = null

  for (const [i, line] of lines.entries()) {
    const record = JSON.parse(line) as Partial<TranscriptRecord>
    if (
      typeof record.schemaVersion !== 'number' ||
      record.schemaVersion < TRANSCRIPT_SCHEMA_VERSION
    ) {
      throw new Error(
        `${file}:${i + 1} has schemaVersion ${String(record.schemaVersion)}; ` +
          `${TRANSCRIPT_SCHEMA_VERSION} is required. Re-export it with ` +
          '`pnpm transcript:export`, or delete it — pre-v2 exports silently ' +
          'dropped tool failures.',
      )
    }
    if (record.type === 'prompt_sent') {
      current = { index: turns.length + 1, updates: [] }
      turns.push(current)
      continue
    }
    if (record.type === 'agent_update' && current) {
      current.updates.push(record.payload as RawAgentUpdate)
      continue
    }
    if (record.type && TURN_CLOSING.has(record.type)) current = null
  }

  return { name: basename(file).replace(/\.jsonl$/, ''), turns }
}
