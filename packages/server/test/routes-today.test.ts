import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { decisions, evidenceItems, planTasks } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

async function withProject(_db: Db, app: ReturnType<typeof buildApp>) {
  const repo = makeTempRepo()
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { repoPath: repo },
  })
  return res.json().id as string
}

async function withObjective(app: ReturnType<typeof buildApp>, projectId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/objectives`,
    payload: { title: 't', goalText: 'g' },
  })
  return res.json().id as string
}

/** Start of the local calendar day, exactly as the route computes it. */
function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const insideToday = () => new Date(startOfToday().getTime() + 1000).toISOString()
const beforeToday = () => new Date(startOfToday().getTime() - 1000).toISOString()

function setup() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const app = buildApp({ db, bus: new EventBus(db) })
  return { db, app }
}

describe('GET /api/projects/:id/today', () => {
  it('404s for an unknown project', async () => {
    const { app } = setup()
    const res = await app.inject({ method: 'GET', url: '/api/projects/nope/today' })
    expect(res.statusCode).toBe(404)
  })

  it("counts only today's verified tasks", async () => {
    const { db, app } = setup()
    const projectId = await withProject(db, app)
    const objectiveId = await withObjective(app, projectId)
    db.insert(planTasks)
      .values([
        {
          id: `${objectiveId}:0`,
          objectiveId,
          ord: 0,
          title: 'a',
          description: 'd',
          status: 'verified',
          checkpointRef: null,
          startedAt: insideToday(),
          finishedAt: insideToday(),
        },
        {
          id: `${objectiveId}:1`,
          objectiveId,
          ord: 1,
          title: 'b',
          description: 'd',
          status: 'verified',
          checkpointRef: null,
          startedAt: beforeToday(),
          finishedAt: beforeToday(),
        },
        {
          id: `${objectiveId}:2`,
          objectiveId,
          ord: 2,
          title: 'c',
          description: 'd',
          status: 'running',
          checkpointRef: null,
          startedAt: insideToday(),
          finishedAt: null,
        },
      ])
      .run()

    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/today` })
    expect(res.statusCode).toBe(200)
    expect(res.json().verifiedTasks).toBe(1)
  })

  it("counts only today's decisions", async () => {
    const { db, app } = setup()
    const projectId = await withProject(db, app)
    const objectiveId = await withObjective(app, projectId)
    db.insert(decisions)
      .values([
        {
          id: randomUUID(),
          objectiveId,
          question: 'q1',
          options: [],
          recommendedId: 'a',
          chosenId: 'a',
          decidedAt: insideToday(),
          decidedBy: 'user',
          createdAt: insideToday(),
        },
        {
          id: randomUUID(),
          objectiveId,
          question: 'q2',
          options: [],
          recommendedId: 'a',
          chosenId: 'a',
          decidedAt: beforeToday(),
          decidedBy: 'user',
          createdAt: beforeToday(),
        },
        {
          id: randomUUID(),
          objectiveId,
          question: 'q3 (undecided)',
          options: [],
          recommendedId: 'a',
          chosenId: null,
          decidedAt: null,
          decidedBy: null,
          createdAt: insideToday(),
        },
      ])
      .run()

    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/today` })
    expect(res.json().decisionsMade).toBe(1)
  })

  it("counts only today's passing checks", async () => {
    const { db, app } = setup()
    const projectId = await withProject(db, app)
    const objectiveId = await withObjective(app, projectId)
    db.insert(evidenceItems)
      .values([
        {
          id: randomUUID(),
          objectiveId,
          taskId: null,
          commandId: 'check-0',
          kind: 'check',
          status: 'pass',
          headline: 'Confirmed by the user',
          summary: [],
          artifactPath: null,
          decidedBy: 'user',
          createdAt: insideToday(),
        },
        {
          id: randomUUID(),
          objectiveId,
          taskId: null,
          commandId: 'check-0',
          kind: 'check',
          status: 'pass',
          headline: 'Confirmed by the user',
          summary: [],
          artifactPath: null,
          decidedBy: 'user',
          createdAt: beforeToday(),
        },
        {
          id: randomUUID(),
          objectiveId,
          taskId: null,
          commandId: 'test',
          kind: 'test',
          status: 'pass',
          headline: 'suite green',
          summary: [],
          artifactPath: null,
          decidedBy: null,
          createdAt: insideToday(),
        },
        {
          id: randomUUID(),
          objectiveId,
          taskId: null,
          commandId: 'check-1',
          kind: 'check',
          status: 'fail',
          headline: 'Marked unmet by the user',
          summary: [],
          artifactPath: null,
          decidedBy: 'user',
          createdAt: insideToday(),
        },
      ])
      .run()

    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/today` })
    expect(res.json().checksPassed).toBe(1)
  })

  it("excludes another project's rows from every count", async () => {
    const { db, app } = setup()
    const projectId = await withProject(db, app)
    const objectiveId = await withObjective(app, projectId)
    const otherProjectId = await withProject(db, app)
    const otherObjectiveId = await withObjective(app, otherProjectId)

    db.insert(planTasks)
      .values({
        id: `${otherObjectiveId}:0`,
        objectiveId: otherObjectiveId,
        ord: 0,
        title: 'a',
        description: 'd',
        status: 'verified',
        checkpointRef: null,
        startedAt: insideToday(),
        finishedAt: insideToday(),
      })
      .run()
    // The target project has an objective but no rows of its own — proves the
    // count is genuinely zero rather than accidentally counting the other
    // project's row.
    void objectiveId

    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/today` })
    expect(res.json().verifiedTasks).toBe(0)
  })

  it("returns today's date", async () => {
    const { db, app } = setup()
    const projectId = await withProject(db, app)
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/today` })
    const today = startOfToday()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const d = String(today.getDate()).padStart(2, '0')
    const expectedDate = `${y}-${m}-${d}`
    expect(res.json().date).toBe(expectedDate)
  })
})
