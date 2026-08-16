import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VerificationSpec } from '@vadd/core'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { evidenceItems, objectives } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { runSetup } from '../src/verification/setup.js'
import { makeObjectiveRow, withTempHome } from './fixtures/temp-repo.js'

function spec(setup: { id: string; run: string; cwd?: string }[]): VerificationSpec {
  return {
    verify: {
      setup: setup.map((s) => ({ cwd: '.', ...s })),
      commands: [],
      checks: [],
      timeoutSec: 600,
    },
    policy: { protectedGlobs: [], maxFastFixLines: 150 },
  }
}

let db: Db
let bus: EventBus
let objective: typeof objectives.$inferSelect

beforeEach(() => {
  const home = withTempHome()
  db = createDb(`${home}/vadd.db`)
  bus = new EventBus(db)
  objective = makeObjectiveRow(db)
})

describe('runSetup', () => {
  it('runs each command in order and stamps setupAt', async () => {
    const ok = await runSetup(
      { db, bus },
      objective,
      spec([
        { id: 'one', run: 'echo first > a.txt' },
        { id: 'two', run: 'echo second > b.txt' },
      ]),
    )
    expect(ok).toBe(true)
    const row = db.select().from(objectives).where(eq(objectives.id, objective.id)).get()
    expect(row?.setupAt).toBeTruthy()
    expect(row?.status).toBe('idle')
    expect(readFileSync(join(objective.worktreePath ?? '', 'b.txt'), 'utf8')).toContain('second')
  })

  it('writes one evidence row per setup command with a log', async () => {
    await runSetup({ db, bus }, objective, spec([{ id: 'one', run: 'echo hello' }]))
    const rows = db.select().from(evidenceItems).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.commandId).toBeNull()
    expect(rows[0]?.kind).toBe('artifact')
    expect(rows[0]?.status).toBe('pass')
    expect(readFileSync(rows[0]?.artifactPath ?? '', 'utf8')).toContain('hello')
  })

  it('a setup row never carries a commandId, so it cannot satisfy the guard', async () => {
    await runSetup({ db, bus }, objective, spec([{ id: 'test', run: 'echo x' }]))
    expect(
      db
        .select()
        .from(evidenceItems)
        .all()
        .every((r) => r.commandId === null),
    ).toBe(true)
  })

  it('stops at the first failure and lands the objective in setup_failed', async () => {
    const ok = await runSetup(
      { db, bus },
      objective,
      spec([
        { id: 'one', run: 'exit 3' },
        { id: 'two', run: 'echo never > never.txt' },
      ]),
    )
    expect(ok).toBe(false)
    const row = db.select().from(objectives).where(eq(objectives.id, objective.id)).get()
    expect(row?.status).toBe('setup_failed')
    expect(row?.setupAt).toBeNull()
    const rows = db.select().from(evidenceItems).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('fail')
  })

  it('respects cwd', async () => {
    mkdirSync(join(objective.worktreePath ?? '', 'sub'), { recursive: true })
    await runSetup(
      { db, bus },
      objective,
      spec([{ id: 'one', run: 'pwd > where.txt', cwd: 'sub' }]),
    )
    const where = readFileSync(join(objective.worktreePath ?? '', 'sub', 'where.txt'), 'utf8')
    expect(where.trim().endsWith('sub')).toBe(true)
  })

  it('a spec with no setup commands succeeds and still stamps setupAt', async () => {
    const ok = await runSetup({ db, bus }, objective, spec([]))
    expect(ok).toBe(true)
    const row = db.select().from(objectives).where(eq(objectives.id, objective.id)).get()
    expect(row?.setupAt).toBeTruthy()
  })

  it('refuses a denied command without running it', async () => {
    const ok = await runSetup(
      { db, bus },
      objective,
      spec([{ id: 'evil', run: 'sudo touch /etc/should-not-exist' }]),
    )
    expect(ok).toBe(false)
    expect(db.select().from(evidenceItems).all()[0]?.headline).toMatch(/sudo/i)
  })
})
