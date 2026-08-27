import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
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

describe('GET /api/fs/browse', () => {
  it('defaults to the home directory when no path is given', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fs/browse' })
    expect(res.statusCode).toBe(200)
    expect(res.json().path).toBe(homedir())
  })

  it('lists only subdirectories of the given path, not files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vadd-browse-'))
    mkdirSync(join(root, 'a-dir'))
    writeFileSync(join(root, 'a-file.txt'), 'hi')

    const res = await app.inject({ method: 'GET', url: `/api/fs/browse?path=${root}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.path).toBe(root)
    expect(body.entries).toEqual([{ name: 'a-dir', path: join(root, 'a-dir'), isGitRepo: false }])
  })

  it('flags a subdirectory containing .git as a git repo', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vadd-browse-'))
    mkdirSync(join(root, 'repo'))
    mkdirSync(join(root, 'repo', '.git'))
    mkdirSync(join(root, 'plain'))

    const res = await app.inject({ method: 'GET', url: `/api/fs/browse?path=${root}` })
    const body = res.json()
    expect(body.entries).toEqual(
      expect.arrayContaining([
        { name: 'repo', path: join(root, 'repo'), isGitRepo: true },
        { name: 'plain', path: join(root, 'plain'), isGitRepo: false },
      ]),
    )
  })

  it('reports the parent directory, and null at the filesystem root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vadd-browse-'))
    mkdirSync(join(root, 'child'))

    const nested = await app.inject({
      method: 'GET',
      url: `/api/fs/browse?path=${join(root, 'child')}`,
    })
    expect(nested.json().parent).toBe(root)

    const atRoot = await app.inject({ method: 'GET', url: '/api/fs/browse?path=/' })
    expect(atRoot.json().parent).toBeNull()
  })

  it('400s on a path that does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/fs/browse?path=${join(tmpdir(), 'vadd-browse-does-not-exist')}`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBeTypeOf('string')
  })

  it('400s on a relative path', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fs/browse?path=relative/dir' })
    expect(res.statusCode).toBe(400)
  })
})
