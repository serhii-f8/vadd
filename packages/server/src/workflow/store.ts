import type { MachineStateName } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { machineSnapshots, objectives } from '../db/schema.js'
import type { EventBus, VaddEvent } from '../events/event-bus.js'

export type StoreDeps = { db: Db; bus: EventBus }

export type TransitionArgs = {
  objectiveId: string
  state: MachineStateName
  snapshot: unknown
  event: { type: string; payload: unknown }
}

/**
 * Design §6.5: better-sqlite3 is synchronous, so a transition's snapshot row
 * and its event row go in **one transaction**. There is no snapshot whose event
 * was lost, and no event whose snapshot did not land.
 *
 * The fan-out deliberately happens *after* the transaction returns: an SSE
 * subscriber that has seen an event cannot un-see it if the write rolls back.
 */
export function commitTransition(deps: StoreDeps, args: TransitionArgs): VaddEvent {
  const { db, bus } = deps
  const now = new Date().toISOString()

  const row = db.transaction((tx) => {
    const inserted = bus.appendWithin(tx as unknown as Db, {
      objectiveId: args.objectiveId,
      type: args.event.type,
      payload: args.event.payload,
    })

    tx.insert(machineSnapshots)
      .values({ objectiveId: args.objectiveId, snapshot: args.snapshot, updatedAt: now })
      .onConflictDoUpdate({
        target: machineSnapshots.objectiveId,
        set: { snapshot: args.snapshot, updatedAt: now },
      })
      .run()

    // The status column mirrors the machine so the objective list and the boot
    // sweep can read a state without deserialising a snapshot. The CHECK added
    // in Task 1 is what makes that mirror trustworthy.
    tx.update(objectives)
      .set({ status: args.state, updatedAt: now })
      .where(eq(objectives.id, args.objectiveId))
      .run()

    return inserted
  })

  bus.dispatch(row)
  return row
}

export function loadSnapshot(db: Db, objectiveId: string): unknown | null {
  const row = db
    .select()
    .from(machineSnapshots)
    .where(eq(machineSnapshots.objectiveId, objectiveId))
    .get()
  return row?.snapshot ?? null
}
