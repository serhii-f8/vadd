import { and, eq, gt } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { events } from '../db/schema.js'

export type VaddEvent = {
  id: number
  objectiveId: string | null
  type: string
  payload: unknown
  createdAt: string
}

type Subscriber = {
  objectiveId: string | null
  cb: (e: VaddEvent) => void
}

/**
 * Append-only event log plus in-process fan-out.
 *
 * `events.id` is the SSE event id and the Last-Event-ID resume cursor
 * (design §4.2), which is why `emit` is synchronous: better-sqlite3 is
 * synchronous, and an async emit would let two writes interleave between
 * insert and dispatch, delivering events out of id order.
 */
export class EventBus {
  readonly #subs = new Set<Subscriber>()

  constructor(private readonly db: Db) {}

  emit(e: { objectiveId?: string | null; type: string; payload: unknown }): VaddEvent {
    const row = this.db
      .insert(events)
      .values({
        objectiveId: e.objectiveId ?? null,
        type: e.type,
        payload: e.payload,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get() as VaddEvent

    for (const sub of this.#subs) {
      if (sub.objectiveId !== null && sub.objectiveId !== row.objectiveId) continue
      try {
        sub.cb(row)
      } catch {
        // One bad subscriber (e.g. a half-closed SSE socket) must not stop the rest.
      }
    }
    return row
  }

  /** `objectiveId: null` subscribes to everything. */
  subscribe(objectiveId: string | null, cb: (e: VaddEvent) => void): () => void {
    const sub: Subscriber = { objectiveId, cb }
    this.#subs.add(sub)
    return () => {
      this.#subs.delete(sub)
    }
  }

  since(objectiveId: string | null, lastId: number): VaddEvent[] {
    const where =
      objectiveId === null
        ? gt(events.id, lastId)
        : and(gt(events.id, lastId), eq(events.objectiveId, objectiveId))
    return this.db.select().from(events).where(where).orderBy(events.id).all() as VaddEvent[]
  }
}
