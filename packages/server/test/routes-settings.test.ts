import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { SUMMARIZER_KEY_SETTING } from '../src/contract/summarizer.js'
import { createDb, type Db } from '../src/db/client.js'
import { settings } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { withTempHome } from './fixtures/temp-repo.js'

let db: Db
let app: ReturnType<typeof buildApp>

beforeEach(() => {
  withTempHome()
  db = createDb(`${process.env.VADD_HOME}/vadd.db`)
  app = buildApp({ db, bus: new EventBus(db) })
})

describe('GET /api/settings', () => {
  it('reports absence without inventing a key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ summarizerKeyPresent: false })
  })

  it('reports presence and never the key itself', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { summarizerKey: 'sk-ant-secret-value' },
    })
    const res = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(res.json()).toEqual({ summarizerKeyPresent: true })
    expect(res.body).not.toContain('sk-ant-secret-value')
  })
})

describe('PUT /api/settings', () => {
  it('stores the key where summarizerFromSettings reads it', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { summarizerKey: 'sk-ant-abc' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('sk-ant-abc')
    const row = db.select().from(settings).where(eq(settings.key, SUMMARIZER_KEY_SETTING)).get()
    expect(row?.value).toBe('sk-ant-abc')
  })

  it('overwrites rather than inserting a duplicate', async () => {
    for (const key of ['sk-one', 'sk-two']) {
      await app.inject({ method: 'PUT', url: '/api/settings', payload: { summarizerKey: key } })
    }
    const rows = db.select().from(settings).where(eq(settings.key, SUMMARIZER_KEY_SETTING)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.value).toBe('sk-two')
  })

  it('clears the key on null, disarming the summarizer', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { summarizerKey: 'sk-ant' } })
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { summarizerKey: null } })
    expect(
      db.select().from(settings).where(eq(settings.key, SUMMARIZER_KEY_SETTING)).get(),
    ).toBeUndefined()
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).json()).toEqual({
      summarizerKeyPresent: false,
    })
  })

  it('400s on a body it does not understand', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { nope: 1 } })
    expect(res.statusCode).toBe(400)
  })
})
