import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import {
  agentSessions,
  decisions,
  evidenceItems,
  machineSnapshots,
  objectives,
  planTasks,
  projects,
} from '../src/db/schema.js'
import { withTempHome } from './fixtures/temp-repo.js'

let home: string
let db: Db

function seedObjective(id: string, status = 'idle') {
  db.insert(projects)
    .values({ id: 'p1', name: 'p', repoPath: `/tmp/repo-${id}`, config: {}, createdAt: 'now' })
    .onConflictDoNothing()
    .run()
  db.insert(objectives)
    .values({
      id,
      projectId: 'p1',
      title: 't',
      goalText: 'g',
      worktreePath: null,
      branchName: null,
      status,
      mode: 'standard',
      verificationSpec: null,
      lowEnergy: false,
      setupAt: null,
      createdAt: 'now',
      updatedAt: 'now',
    })
    .run()
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'vadd-db-'))
  process.env.VADD_HOME = home
  db = createDb(join(home, 'vadd.db'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('phase 3 migration', () => {
  it('stores one snapshot per objective, latest only', () => {
    seedObjective('o1')
    db.insert(machineSnapshots)
      .values({ objectiveId: 'o1', snapshot: { value: 'exploring' }, updatedAt: 'a' })
      .run()
    db.insert(machineSnapshots)
      .values({ objectiveId: 'o1', snapshot: { value: 'planning' }, updatedAt: 'b' })
      .onConflictDoUpdate({
        target: machineSnapshots.objectiveId,
        set: { snapshot: { value: 'planning' }, updatedAt: 'b' },
      })
      .run()
    const rows = db.select().from(machineSnapshots).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.snapshot).toEqual({ value: 'planning' })
  })

  it('stores decisions, plan tasks and evidence items', () => {
    seedObjective('o2')
    db.insert(decisions)
      .values({
        id: 'd1',
        objectiveId: 'o2',
        question: 'q',
        options: [{ id: 'a' }],
        recommendedId: 'a',
        chosenId: null,
        decidedAt: null,
        decidedBy: null,
        createdAt: 'now',
      })
      .run()
    db.insert(planTasks)
      .values({
        id: 't1',
        objectiveId: 'o2',
        ord: 0,
        title: 'task',
        description: 'do it',
        status: 'pending',
        checkpointRef: null,
        startedAt: null,
        finishedAt: null,
      })
      .run()
    db.insert(evidenceItems)
      .values({
        id: 'e1',
        objectiveId: 'o2',
        taskId: 't1',
        commandId: 'test',
        kind: 'test',
        status: 'pass',
        headline: '12 passed',
        summary: ['all green'],
        artifactPath: null,
        createdAt: 'now',
      })
      .run()
    expect(db.select().from(decisions).all()).toHaveLength(1)
    expect(db.select().from(planTasks).all()).toHaveLength(1)
    expect(db.select().from(evidenceItems).all()[0]?.commandId).toBe('test')
  })

  it('rejects a status that is not a machine state', () => {
    expect(() => seedObjective('o3', 'ready')).toThrow(/CHECK/i)
  })

  it('allows creating, the pre-machine status boot reconciliation sweeps', () => {
    expect(() => seedObjective('o4', 'creating')).not.toThrow()
  })

  it('defaults mode to standard and lowEnergy to false', () => {
    seedObjective('o5')
    const row = db.select().from(objectives).all()[0]
    expect(row?.mode).toBe('standard')
    expect(row?.lowEnergy).toBe(false)
  })
})

describe('phase 4 migration', () => {
  const objectiveId = 'o-phase4'
  beforeEach(() => {
    seedObjective(objectiveId)
  })

  it('A7: evidence_items accepts decidedBy', () => {
    db.insert(evidenceItems)
      .values({
        id: 'ev-1',
        objectiveId,
        taskId: null,
        commandId: 'check-0',
        kind: 'check',
        status: 'pass',
        headline: 'Ticked by the user',
        summary: [],
        artifactPath: null,
        decidedBy: 'user',
        createdAt: new Date().toISOString(),
      })
      .run()

    const row = db.select().from(evidenceItems).where(eq(evidenceItems.id, 'ev-1')).get()
    expect(row?.decidedBy).toBe('user')
  })

  it('A7: decidedBy is nullable for collector and agent rows', () => {
    db.insert(evidenceItems)
      .values({
        id: 'ev-2',
        objectiveId,
        taskId: null,
        commandId: 'test',
        kind: 'test',
        status: 'pass',
        headline: 'OK (12 tests, 30 assertions)',
        summary: [],
        artifactPath: null,
        createdAt: new Date().toISOString(),
      })
      .run()

    const row = db.select().from(evidenceItems).where(eq(evidenceItems.id, 'ev-2')).get()
    expect(row?.decidedBy).toBeNull()
  })

  it('objectives accepts the pre-machine setup_failed status', () => {
    db.update(objectives)
      .set({ status: 'setup_failed' })
      .where(eq(objectives.id, objectiveId))
      .run()
    const row = db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()
    expect(row?.status).toBe('setup_failed')
  })
})

describe('amendment A8 columns', () => {
  it('stores baseSha and integrateAction on an objective', () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const now = new Date().toISOString()
    db.insert(projects)
      .values({ id: 'p1', name: 'p', repoPath: '/tmp/p', config: {}, createdAt: now })
      .run()
    db.insert(objectives)
      .values({
        id: 'o1',
        projectId: 'p1',
        title: 't',
        goalText: 'g',
        status: 'idle',
        baseSha: 'deadbeef',
        integrateAction: 'commit',
        createdAt: now,
        updatedAt: now,
      })
      .run()
    const row = db.select().from(objectives).where(eq(objectives.id, 'o1')).get()
    expect(row?.baseSha).toBe('deadbeef')
    expect(row?.integrateAction).toBe('commit')
  })

  it('defaults both to null', () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const now = new Date().toISOString()
    db.insert(projects)
      .values({ id: 'p1', name: 'p', repoPath: '/tmp/p', config: {}, createdAt: now })
      .run()
    db.insert(objectives)
      .values({
        id: 'o1',
        projectId: 'p1',
        title: 't',
        goalText: 'g',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
      })
      .run()
    const row = db.select().from(objectives).where(eq(objectives.id, 'o1')).get()
    expect(row?.baseSha).toBeNull()
    expect(row?.integrateAction).toBeNull()
  })

  it('rejects an integrateAction outside the enum', () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const now = new Date().toISOString()
    db.insert(projects)
      .values({ id: 'p1', name: 'p', repoPath: '/tmp/p', config: {}, createdAt: now })
      .run()
    expect(() =>
      db
        .insert(objectives)
        .values({
          id: 'o1',
          projectId: 'p1',
          title: 't',
          goalText: 'g',
          status: 'idle',
          // biome-ignore lint/suspicious/noExplicitAny: proving the CHECK exists
          integrateAction: 'merge' as any,
          createdAt: now,
          updatedAt: now,
        })
        .run(),
    ).toThrow()
  })

  it('stores a childPid on an agent session', () => {
    const home = withTempHome()
    const db = createDb(`${home}/vadd.db`)
    const now = new Date().toISOString()
    db.insert(projects)
      .values({ id: 'p1', name: 'p', repoPath: '/tmp/p', config: {}, createdAt: now })
      .run()
    db.insert(objectives)
      .values({
        id: 'o1',
        projectId: 'p1',
        title: 't',
        goalText: 'g',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
      })
      .run()
    db.insert(agentSessions)
      .values({
        id: 's1',
        objectiveId: 'o1',
        acpSessionId: 'acp-1',
        status: 'running',
        childPid: 4242,
        startedAt: now,
      })
      .run()
    expect(db.select().from(agentSessions).where(eq(agentSessions.id, 's1')).get()?.childPid).toBe(
      4242,
    )
  })
})
