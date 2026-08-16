import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { makeObjectiveRow, withTempHome } from './fixtures/temp-repo.js'

let db: Db
let bus: EventBus
let app: ReturnType<typeof buildApp>
let objectiveId: string

beforeEach(() => {
  withTempHome()
  db = createDb(`${process.env.VADD_HOME}/vadd.db`)
  bus = new EventBus(db)
  app = buildApp({ db, bus })
  objectiveId = makeObjectiveRow(db).id
})

describe('GET /api/objectives/:id/raw', () => {
  it('returns every event for the objective, oldest first', async () => {
    bus.emit({ objectiveId, type: 'status', payload: { n: 1 } })
    bus.emit({ objectiveId, type: 'status', payload: { n: 2 } })
    const res = await app.inject({ method: 'GET', url: `/api/objectives/${objectiveId}/raw` })
    expect(res.statusCode).toBe(200)
    const rows = res.json() as Array<{ id: number; payload: { n: number } }>
    expect(rows.map((r) => r.payload.n)).toEqual([1, 2])
    const [first, second] = rows
    if (!first || !second) throw new Error('expected two rows')
    expect(first.id).toBeLessThan(second.id)
  })

  it('pages forward from ?since=', async () => {
    const first = bus.emit({ objectiveId, type: 'status', payload: { n: 1 } })
    bus.emit({ objectiveId, type: 'status', payload: { n: 2 } })
    const res = await app.inject({
      method: 'GET',
      url: `/api/objectives/${objectiveId}/raw?since=${first.id}`,
    })
    expect((res.json() as Array<{ payload: { n: number } }>).map((r) => r.payload.n)).toEqual([2])
  })

  it('404s for an unknown objective', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/objectives/nope/raw' })
    expect(res.statusCode).toBe(404)
  })
})
