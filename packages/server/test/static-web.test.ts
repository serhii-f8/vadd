import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerStaticWeb } from '../src/http/static.js'

function webDist() {
  const dir = mkdtempSync(join(tmpdir(), 'vadd-web-dist-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>vadd</title>')
  writeFileSync(join(dir, 'app.js'), 'console.log("hi")')
  return dir
}

describe('registerStaticWeb', () => {
  it('serves a real static file by exact path', async () => {
    const app = Fastify({ logger: false })
    await registerStaticWeb(app, webDist())
    const res = await app.inject({ method: 'GET', url: '/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('console.log')
  })

  it('falls back to index.html for a client-side route', async () => {
    const app = Fastify({ logger: false })
    await registerStaticWeb(app, webDist())
    const res = await app.inject({ method: 'GET', url: '/o/some-objective-id' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<title>vadd</title>')
  })

  it('does not shadow an /api route registered on the same app', async () => {
    const app = Fastify({ logger: false })
    app.get('/api/probe', async () => ({ ok: true }))
    await registerStaticWeb(app, webDist())
    const res = await app.inject({ method: 'GET', url: '/api/probe' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('404s an unmatched /api path rather than falling back to index.html', async () => {
    const app = Fastify({ logger: false })
    await registerStaticWeb(app, webDist())
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('<title>vadd</title>')
  })
})
