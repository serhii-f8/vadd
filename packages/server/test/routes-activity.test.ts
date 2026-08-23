import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { EventBus } from '../src/events/event-bus.js'
import { activityFor } from '../src/http/activity.js'
import { buildApp } from '../src/http/app.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

/**
 * The Focus View's activity signals.
 *
 * All three are read off the existing append-only `events` log — no schema
 * change, no new writer. The frontend never reads SSE payloads (spec §7), so
 * the aggregate is the only channel these can reach the UI through, exactly
 * like amendment A12's `lastAutoApproval`.
 */
async function withObjective() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const app = buildApp({ db, bus })
  const repo = makeTempRepo()
  const projectId = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { repoPath: repo } })
  ).json().id as string
  const id = (
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objectives`,
      payload: { title: 't', goalText: 'g' },
    })
  ).json().id as string
  return { app, bus, id }
}

/** The real `agent_event` payload shape: a `ContractPipeline` emission. */
function statusEmission(headline: string, phase = 'executing') {
  return {
    kind: 'event',
    turnId: 'turn-1',
    event: { type: 'status', phase, headline },
    extracted: false,
    sourceEventIds: [1],
  }
}

test('lastStatus is the newest status the agent emitted', async () => {
  const { app, bus, id } = await withObjective()
  bus.emit({ objectiveId: id, type: 'agent_event', payload: statusEmission('Reading the router') })
  bus.emit({
    objectiveId: id,
    type: 'agent_event',
    payload: statusEmission('Writing the failing test', 'verifying'),
  })

  const agg = (await app.inject({ method: 'GET', url: `/api/objectives/${id}` })).json()

  expect(agg.lastStatus).toMatchObject({
    headline: 'Writing the failing test',
    phase: 'verifying',
  })
  expect(typeof agg.lastStatus.at).toBe('string')
})

test('lastStatus ignores agent events that are not status events', async () => {
  const { app, bus, id } = await withObjective()
  bus.emit({ objectiveId: id, type: 'agent_event', payload: statusEmission('Reading the router') })
  bus.emit({
    objectiveId: id,
    type: 'agent_event',
    payload: {
      kind: 'event',
      turnId: 'turn-1',
      event: { type: 'task_result', taskId: 't0', claim: 'done', evidenceRefs: [] },
      extracted: false,
      sourceEventIds: [2],
    },
  })

  const agg = (await app.inject({ method: 'GET', url: `/api/objectives/${id}` })).json()

  // The newest row is a `task_result`, which carries no headline. Reading the
  // newest `agent_event` row and hoping it is a status would show `undefined`.
  expect(agg.lastStatus.headline).toBe('Reading the router')
})

test('lastStatus is null when the agent has emitted none', async () => {
  const { app, id } = await withObjective()
  const agg = (await app.inject({ method: 'GET', url: `/api/objectives/${id}` })).json()
  expect(agg.lastStatus).toBeNull()
})

test('lastAgentUpdateAt is the newest raw agent update timestamp', async () => {
  const { app, bus, id } = await withObjective()
  expect(
    (await app.inject({ method: 'GET', url: `/api/objectives/${id}` })).json().lastAgentUpdateAt,
  ).toBeNull()

  const row = bus.emit({ objectiveId: id, type: 'agent_update', payload: { sessionUpdate: 'x' } })

  const agg = (await app.inject({ method: 'GET', url: `/api/objectives/${id}` })).json()
  expect(agg.lastAgentUpdateAt).toBe(row.createdAt)
})

test('lastProblem is null for an objective that has hit none', () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  // Direct, because there is no such objective to reach through the route: a
  // repo with no auto-detectable verification spec gets a
  // `verification_unresolved` at creation (see the supersession test below),
  // which is a genuine problem and correctly reported as one.
  expect(activityFor(db, 'no-such-objective')).toEqual({
    lastStatus: null,
    lastAgentUpdateAt: null,
    lastProblem: null,
  })
})

test('lastProblem reports the newest failure, superseding an older one', async () => {
  const { app, bus, id } = await withObjective()
  // Creation already emitted `verification_unresolved`: the fixture repo has
  // no detectable verification spec. That is the objective's first problem.
  const atCreation = (await app.inject({ method: 'GET', url: `/api/objectives/${id}` })).json()
  expect(atCreation.lastProblem?.type).toBe('verification_unresolved')

  bus.emit({
    objectiveId: id,
    type: 'record_plan_failed',
    payload: { message: 'UNIQUE constraint failed: plan_tasks.id' },
  })

  const agg = (await app.inject({ method: 'GET', url: `/api/objectives/${id}` })).json()
  expect(agg.lastProblem).toMatchObject({
    type: 'record_plan_failed',
    message: 'UNIQUE constraint failed: plan_tasks.id',
  })
})

test('lastProblem ignores ordinary events emitted after the failure', async () => {
  const { app, bus, id } = await withObjective()
  bus.emit({
    objectiveId: id,
    type: 'record_plan_failed',
    payload: { message: 'UNIQUE constraint failed: plan_tasks.id' },
  })
  // The transition into `paused` is appended *after* the failure that caused
  // it — reading the newest row of any type would report this instead.
  bus.emit({ objectiveId: id, type: 'state_changed', payload: { from: 'verifying', to: 'paused' } })

  const agg = (await app.inject({ method: 'GET', url: `/api/objectives/${id}` })).json()
  expect(agg.lastProblem?.type).toBe('record_plan_failed')
})
