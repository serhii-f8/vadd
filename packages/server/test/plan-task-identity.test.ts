import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '@vadd/core'
import { planTaskId } from '@vadd/core'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortFactory } from '../src/agent/registry.js'
import { AgentRegistry } from '../src/agent/registry.js'
import { createDb, type Db } from '../src/db/client.js'
import { objectives, planTasks, projects } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { WorkflowRunner } from '../src/workflow/runner.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

/**
 * Two objectives, both planned, in one database.
 *
 * `workflow-effects.test.ts` drives exactly one objective, which is precisely
 * why `plan_tasks.id = '0'` shipped: positional ids are unique inside one
 * objective and unique nowhere else, so the *second* objective ever to reach
 * `planning` collided on the primary key, recorded no rows, and offered the
 * user an empty plan to approve — while its checkpoint write, addressed by id
 * alone, landed on the *first* objective's row.
 */

const STATUS_EVENT: AgentEvent = { type: 'status', phase: 'exploring', headline: 'Looking around' }

function planEvent(...titles: string[]): AgentEvent {
  return {
    type: 'plan',
    tasks: titles.map((title) => ({ title, description: `do ${title}` })),
  }
}

type StubHandle = {
  queue: (...batches: AgentEvent[][]) => void
  settleNext: () => void
  prompts: () => number
}

/**
 * Per-objective fake agent. Unlike `workflow-effects.test.ts`'s single-port
 * stub, every port owns its own `onUpdate`, prompt queue and resolver list —
 * with one shared `onUpdate` the second port silently steals the first's
 * emissions, which would make a two-objective test measure nothing.
 */
function stubFactory() {
  const handles = new Map<string, StubHandle>()

  const factory: PortFactory = ({ objectiveId }) => {
    let onUpdate: ((u: unknown) => void) | undefined
    let prompts = 0
    const eventQueue: AgentEvent[][] = []
    const resolvers: Array<(v: { stopReason: string }) => void> = []

    handles.set(objectiveId, {
      queue: (...batches) => {
        eventQueue.push(...batches)
      },
      settleNext: () => {
        const resolve = resolvers.shift()
        if (!resolve) throw new Error(`no pending fake prompt for ${objectiveId}`)
        resolve({ stopReason: 'end_turn' })
      },
      prompts: () => prompts,
    })

    const port = {
      async start() {},
      async newSession() {
        return { sessionId: `session-${objectiveId}` }
      },
      async prompt(sessionId: string) {
        prompts += 1
        for (const event of eventQueue.shift() ?? []) {
          onUpdate?.({
            sessionId,
            receivedAt: new Date().toISOString(),
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: {
                type: 'text',
                text: `\`\`\`vadd-event\n${JSON.stringify(event)}\n\`\`\`\n`,
              },
            },
          })
        }
        return new Promise<{ stopReason: string }>((resolve) => {
          resolvers.push(resolve)
        })
      },
      async cancel() {},
      async stop() {},
      onUpdate: (cb: (u: unknown) => void) => {
        onUpdate = cb
        return () => {
          onUpdate = undefined
        }
      },
      onExit: () => () => {},
    }
    return port as unknown as ReturnType<PortFactory>
  }

  return {
    factory,
    handle: (objectiveId: string): StubHandle => {
      const handle = handles.get(objectiveId)
      if (!handle) throw new Error(`no stub port for ${objectiveId}`)
      return handle
    },
  }
}

let db: Db
let bus: EventBus
let runner: WorkflowRunner
let agents: AgentRegistry
let handle: (objectiveId: string) => StubHandle
const worktrees = new Map<string, string>()

beforeEach(() => {
  const home = withTempHome()
  db = createDb(`${home}/vadd.db`)
  bus = new EventBus(db)
  worktrees.clear()

  const stub = stubFactory()
  handle = stub.handle
  let bound!: WorkflowRunner
  agents = new AgentRegistry(db, bus, stub.factory, (objectiveId, emission) => {
    bound.ingest(objectiveId, emission)
  })
  bound = new WorkflowRunner({ db, bus, agents })
  runner = bound

  const now = new Date().toISOString()
  db.insert(projects)
    .values({ id: 'proj-1', name: 'p', repoPath: makeTempRepo(), config: {}, createdAt: now })
    .run()

  // Fast Fix, so a plan is two turns away rather than four: exploring ->
  // planning -> awaitingPlanApproval. Verification is never skipped by it, and
  // nothing here gets that far.
  for (const id of ['obj-a', 'obj-b']) {
    const wt = makeTempRepo()
    worktrees.set(id, wt)
    db.insert(objectives)
      .values({
        id,
        projectId: 'proj-1',
        title: id,
        goalText: 'g',
        worktreePath: wt,
        branchName: `vadd/${id}`,
        status: 'idle',
        mode: 'fastfix',
        verificationSpec: null,
        lowEnergy: false,
        setupAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }
})

/** Drains the microtask queue after settling one fake prompt. */
async function settleFakeTurn(objectiveId: string): Promise<void> {
  handle(objectiveId).settleNext()
  for (let i = 0; i < 25; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

/** idle -> exploring -> planning -> awaitingPlanApproval, with `titles` planned. */
async function planObjective(objectiveId: string, ...titles: string[]): Promise<void> {
  await agents.ensure({ id: objectiveId, worktreePath: worktrees.get(objectiveId) ?? null })
  runner.start(objectiveId)
  handle(objectiveId).queue([STATUS_EVENT], [planEvent(...titles)])
  runner.send(objectiveId, { type: 'START' })
  await settleFakeTurn(objectiveId) // explore settles -> planning prompts
  await settleFakeTurn(objectiveId) // plan settles -> awaitingPlanApproval
}

const tasksOf = (objectiveId: string) =>
  db
    .select()
    .from(planTasks)
    .where(eq(planTasks.objectiveId, objectiveId))
    .orderBy(planTasks.ord)
    .all()

describe('plan task identity', () => {
  it('records a plan for a second objective without colliding with the first', async () => {
    await planObjective('obj-a', 'A one', 'A two')
    await planObjective('obj-b', 'B one', 'B two')

    expect(tasksOf('obj-a').map((r) => r.title)).toEqual(['A one', 'A two'])
    expect(tasksOf('obj-b').map((r) => r.title)).toEqual(['B one', 'B two'])
    expect(tasksOf('obj-a').map((r) => r.id)).toEqual([
      planTaskId('obj-a', 0),
      planTaskId('obj-a', 1),
    ])
    expect(tasksOf('obj-b').map((r) => r.id)).toEqual([
      planTaskId('obj-b', 0),
      planTaskId('obj-b', 1),
    ])
    // The whole table, not just each objective's slice: ids must be globally
    // unique because the column is a primary key.
    const all = db.select().from(planTasks).all()
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length)
    expect(runner.get('obj-b')?.getSnapshot().value).toBe('awaitingPlanApproval')
  })

  it("a checkpoint on one objective leaves the other objective's rows alone", async () => {
    await planObjective('obj-a', 'A one', 'A two')
    await planObjective('obj-b', 'B one', 'B two')

    // Something for `git add -A` to find: a clean tree makes `checkpointCommit`
    // return null and write nothing at all.
    const wt = worktrees.get('obj-b') ?? ''
    writeFileSync(join(wt, 'touched.txt'), 'work\n')

    runner.send('obj-b', { type: 'APPROVE_PLAN' })
    // The execute-task prompt is gated on the checkpoint resolving, so a third
    // prompt means `checkpoint`'s write has already landed — somewhere.
    await vi.waitFor(() => expect(handle('obj-b').prompts()).toBeGreaterThanOrEqual(3))

    expect(tasksOf('obj-a').map((r) => r.checkpointRef)).toEqual([null, null])
    expect(tasksOf('obj-a').map((r) => r.status)).toEqual(['pending', 'pending'])
    expect(tasksOf('obj-b')[0]?.checkpointRef).toMatch(/^[0-9a-f]{7,40}$/)
    expect(tasksOf('obj-b')[0]?.status).toBe('running')
    // obj-a's own worktree was never committed to, either.
    const log = execFileSync('git', ['-C', worktrees.get('obj-a') ?? '', 'log', '--format=%s'])
      .toString()
      .trim()
    expect(log).toBe('init')
  })

  it('pauses instead of offering an empty plan when the insert fails', async () => {
    // Any insert failure would do; a squatting primary key is the one that
    // actually shipped. Before this fix `recordPlan` swallowed the error and
    // the machine walked on to `awaitingPlanApproval` with no rows behind it.
    db.insert(planTasks)
      .values({
        id: planTaskId('obj-b', 0),
        objectiveId: 'obj-a',
        ord: 99,
        title: 'squatter',
        description: 'holds obj-b task 0 primary key',
        status: 'pending',
        checkpointRef: null,
        startedAt: null,
        finishedAt: null,
      })
      .run()

    await planObjective('obj-b', 'B one')

    expect(runner.get('obj-b')?.getSnapshot().value).toBe('paused')
    expect(bus.since('obj-b', 0).map((e) => e.type)).toContain('record_plan_failed')
  })
})
