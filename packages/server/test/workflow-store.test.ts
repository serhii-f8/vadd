import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { events, machineSnapshots, objectives, projects } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { commitTransition, loadSnapshot } from '../src/workflow/store.js'

let home: string
let db: Db
let bus: EventBus

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'vadd-store-'))
  process.env.VADD_HOME = home
  db = createDb(join(home, 'vadd.db'))
  bus = new EventBus(db)
  db.insert(projects)
    .values({ id: 'p', name: 'p', repoPath: '/tmp/r', config: {}, createdAt: 'now' })
    .run()
  db.insert(objectives)
    .values({
      id: 'o',
      projectId: 'p',
      title: 't',
      goalText: 'g',
      worktreePath: null,
      branchName: null,
      status: 'idle',
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: 'now',
      updatedAt: 'now',
    })
    .run()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('commitTransition', () => {
  it('writes the snapshot, the event and the status together', () => {
    const row = commitTransition(
      { db, bus },
      {
        objectiveId: 'o',
        state: 'exploring',
        snapshot: { value: 'exploring' },
        event: { type: 'state_changed', payload: { to: 'exploring' } },
      },
    )
    expect(row.id).toBeGreaterThan(0)
    expect(loadSnapshot(db, 'o')).toEqual({ value: 'exploring' })
    expect(db.select().from(events).all()).toHaveLength(1)
    expect(db.select().from(objectives).all()[0]?.status).toBe('exploring')
  })

  it('replaces the snapshot rather than accumulating rows', () => {
    for (const state of ['exploring', 'proposing', 'planning'] as const) {
      commitTransition(
        { db, bus },
        {
          objectiveId: 'o',
          state,
          snapshot: { value: state },
          event: { type: 'state_changed', payload: { to: state } },
        },
      )
    }
    expect(db.select().from(machineSnapshots).all()).toHaveLength(1)
    expect(db.select().from(events).all()).toHaveLength(3)
    expect(loadSnapshot(db, 'o')).toEqual({ value: 'planning' })
  })

  it('leaves no event row when the snapshot write fails', () => {
    // An illegal status trips the CHECK constraint mid-transaction, which is
    // the closest thing to an induced mid-write failure that does not require
    // monkey-patching better-sqlite3.
    expect(() =>
      commitTransition(
        { db, bus },
        {
          objectiveId: 'o',
          // @ts-expect-error deliberately illegal, to induce the rollback
          state: 'not-a-state',
          snapshot: { value: 'x' },
          event: { type: 'state_changed', payload: {} },
        },
      ),
    ).toThrow()
    expect(db.select().from(events).all()).toHaveLength(0)
    expect(db.select().from(machineSnapshots).all()).toHaveLength(0)
  })

  it('does not deliver an event to subscribers before it is committed', () => {
    const seen: number[] = []
    bus.subscribe('o', (e) => seen.push(e.id))
    expect(() =>
      commitTransition(
        { db, bus },
        {
          objectiveId: 'o',
          // @ts-expect-error deliberately illegal
          state: 'not-a-state',
          snapshot: {},
          event: { type: 'state_changed', payload: {} },
        },
      ),
    ).toThrow()
    expect(seen).toEqual([])

    commitTransition(
      { db, bus },
      {
        objectiveId: 'o',
        state: 'exploring',
        snapshot: {},
        event: { type: 'state_changed', payload: {} },
      },
    )
    expect(seen).toHaveLength(1)
  })
})
