import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/client.js'

describe('createDb migrations folder override', () => {
  const originalEnv = process.env.VADD_MIGRATIONS_DIR

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.VADD_MIGRATIONS_DIR
    else process.env.VADD_MIGRATIONS_DIR = originalEnv
  })

  it('uses VADD_MIGRATIONS_DIR when set, instead of the default relative path', () => {
    // A migrations folder containing only a bogus SQL file: if createDb actually
    // reads from here rather than the real packages/server/drizzle folder, this
    // file's statement runs and creates a table we can query directly — proof
    // the override took effect, not an assumption about drizzle's internals.
    const dir = mkdtempSync(join(tmpdir(), 'vadd-migrations-'))
    mkdirSync(join(dir, 'meta'), { recursive: true })
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, when: 1, tag: '0000_probe', breakpoints: true }],
      }),
    )
    writeFileSync(
      join(dir, '0000_probe.sql'),
      'CREATE TABLE probe_marker (id INTEGER PRIMARY KEY);',
    )

    process.env.VADD_MIGRATIONS_DIR = dir

    const dbFile = join(mkdtempSync(join(tmpdir(), 'vadd-db-')), 'vadd.db')
    const db = createDb(dbFile)

    const row = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='probe_marker'")
      .get() as { name: string } | undefined
    expect(row?.name).toBe('probe_marker')

    rmSync(dir, { recursive: true, force: true })
  })
})
