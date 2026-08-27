import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VerificationSpec, VerifyCommand } from '@vadd/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { type objectives, planTasks } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { collectEvidence } from '../src/verification/collector.js'
import { makeObjectiveRow, withTempHome } from './fixtures/temp-repo.js'

function specOf(commands: Partial<VerifyCommand>[], timeoutSec = 600): VerificationSpec {
  return {
    verify: {
      setup: [],
      commands: commands.map((c) => ({
        id: 'test',
        run: 'true',
        required: true,
        allowWarn: false,
        cwd: '.',
        ...c,
      })),
      checks: [],
      timeoutSec,
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

describe('collectEvidence', () => {
  it('writes one row per command, each carrying its commandId', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([
        { id: 'test', run: 'echo ok' },
        { id: 'lint', run: 'echo ok' },
      ]),
      { taskId: null },
    )
    expect(result.items.map((i) => i.commandId)).toEqual(['test', 'lint'])
  })

  it('exit 0 is pass, non-zero is fail', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([
        { id: 'green', run: 'exit 0' },
        { id: 'red', run: 'exit 1' },
      ]),
      { taskId: null },
    )
    expect(result.items.map((i) => i.status)).toEqual(['pass', 'fail'])
  })

  it('exit 0 with warnings is warn', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'lint', run: 'echo "3 problems (0 errors, 3 warnings)"' }]),
      { taskId: null },
    )
    expect(result.items[0]?.status).toBe('warn')
  })

  it('ignores allowWarn — the guard decides whether warn is good enough', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'lint', run: 'echo "3 problems (0 errors, 3 warnings)"', allowWarn: true }]),
      { taskId: null },
    )
    expect(result.items[0]?.status).toBe('warn')
  })

  it('runs a non-required command and records it', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'build', run: 'exit 1', required: false }]),
      { taskId: null },
    )
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.status).toBe('fail')
  })

  it('classifies a security/audit command id as kind: security', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([
        { id: 'audit', run: 'echo ok' },
        { id: 'security', run: 'echo ok' },
      ]),
      { taskId: null },
    )
    expect(result.items.map((i) => i.kind)).toEqual(['security', 'security'])
  })

  it('writes a log per command under the run id', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'test', run: 'echo hello-from-the-suite' }]),
      { taskId: null },
    )
    const log = readFileSync(result.items[0]?.artifactPath ?? '', 'utf8')
    expect(log).toContain('hello-from-the-suite')
    expect(result.items[0]?.artifactPath).toContain(result.runId)
  })

  it('sanitizes a namespaced id for the log filename', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'backend:test', run: 'echo x' }]),
      { taskId: null },
    )
    expect(result.items[0]?.commandId).toBe('backend:test')
    expect(result.items[0]?.artifactPath).toContain('backend-test.log')
  })

  it('honours cwd', async () => {
    mkdirSync(join(objective.worktreePath ?? '', 'sub'), { recursive: true })
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'test', run: 'pwd', cwd: 'sub' }]),
      { taskId: null },
    )
    expect(readFileSync(result.items[0]?.artifactPath ?? '', 'utf8').trim()).toMatch(/sub$/)
  })

  it('a timeout is a fail, not a throw', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'slow', run: 'sleep 5' }], 1),
      { taskId: null },
    )
    expect(result.items[0]?.status).toBe('fail')
    expect(result.items[0]?.headline).toMatch(/slow/)
  })

  it('a timeout actually bounds the wait, rather than reporting one afterwards', async () => {
    // Regression guard. execa's own `timeout` signals the shell only, and the
    // surviving command holds the output pipe open — so this took the full 5s
    // and then called it a timeout, which makes `timeoutSec` decorative.
    const started = Date.now()
    await collectEvidence({ db, bus }, objective, specOf([{ id: 'slow', run: 'sleep 30' }], 1), {
      taskId: null,
    })
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('a denied command is a fail row that never ran', async () => {
    const marker = join(objective.worktreePath ?? '', 'ran.txt')
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'evil', run: `sudo touch ${marker}` }]),
      { taskId: null },
    )
    expect(result.items[0]?.status).toBe('fail')
    expect(result.items[0]?.headline).toMatch(/sudo/i)
    expect(existsSync(marker)).toBe(false)
  })

  it('an aborted run stops and does not record the remaining commands', async () => {
    const controller = new AbortController()
    const promise = collectEvidence(
      { db, bus },
      objective,
      specOf([
        { id: 'slow', run: 'sleep 5' },
        { id: 'never', run: 'echo never' },
      ]),
      { taskId: null, signal: controller.signal },
    )
    setTimeout(() => controller.abort(), 50)
    const result = await promise
    expect(result.items.map((i) => i.commandId)).not.toContain('never')
  })

  it('stamps the current task id on every row', async () => {
    const result = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'test', run: 'true' }]),
      { taskId: null },
    )
    expect(result.items[0]?.taskId).toBeNull()

    // evidence_items.taskId carries a foreign key on plan_tasks, so the row has
    // to exist before anything can point at it.
    db.insert(planTasks)
      .values({
        id: 'task-7',
        objectiveId: objective.id,
        ord: 0,
        title: 't',
        description: 'd',
        status: 'running',
        checkpointRef: null,
        startedAt: null,
        finishedAt: null,
      })
      .run()

    const stamped = await collectEvidence(
      { db, bus },
      objective,
      specOf([{ id: 'test', run: 'true' }]),
      { taskId: 'task-7' },
    )
    expect(stamped.items[0]?.taskId).toBe('task-7')
  })

  it('a fresh run gets a fresh runId', async () => {
    const a = await collectEvidence({ db, bus }, objective, specOf([{ id: 'test', run: 'true' }]), {
      taskId: null,
    })
    const b = await collectEvidence({ db, bus }, objective, specOf([{ id: 'test', run: 'true' }]), {
      taskId: null,
    })
    expect(a.runId).not.toBe(b.runId)
  })
})
