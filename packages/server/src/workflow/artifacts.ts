import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@vadd/core'
import type { Db } from '../db/client.js'
import { artifacts } from '../db/schema.js'

/**
 * Persists one `artifact` emission (amendment A24). Pure DB write, split out
 * of `runner.ts` so the interception there stays one line and this can be
 * tested against a database alone.
 *
 * Throws on a missing objective: a real FK failure is the right answer for a
 * row nothing could ever read, and the runner only calls this for objectives
 * it holds an actor or a row for.
 */
export function recordArtifact(
  db: Db,
  objectiveId: string,
  state: string,
  event: Extract<AgentEvent, { type: 'artifact' }>,
): void {
  db.insert(artifacts)
    .values({
      id: randomUUID(),
      objectiveId,
      state,
      cards: event.cards,
      createdAt: new Date().toISOString(),
    })
    .run()
}
