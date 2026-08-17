import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { agentSessions, objectives, projects } from '../src/db/schema.js'
import { withTempHome } from './fixtures/temp-repo.js'

const drizzleFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

interface Journal {
  entries: { tag: string; when: number }[]
}

/**
 * Builds a database at the `0000` migration state and populates it the way a
 * real installation is populated: projects, objectives, and `agent_sessions`
 * rows whose `objective_id` is `NOT NULL` and points at those objectives.
 *
 * This is the condition every existing db test misses. `createDb` has always
 * been exercised against an empty file, where `0001`'s `DROP TABLE objectives`
 * has no child rows to violate — which is exactly why the defect shipped.
 */
function seedAtBaseline(file: string, rows: number): void {
  const journal = JSON.parse(readFileSync(`${drizzleFolder}/meta/_journal.json`, 'utf8')) as Journal
  const baseline = journal.entries[0]
  if (!baseline) throw new Error('drizzle journal has no entries')

  const sqlite = new Database(file)
  const migrationSql = readFileSync(`${drizzleFolder}/${baseline.tag}.sql`, 'utf8')
  for (const statement of migrationSql.split('--> statement-breakpoint')) {
    sqlite.exec(statement)
  }

  // Exactly the bookkeeping drizzle's own migrator writes, so it sees 0000 as
  // applied and 0001..N as pending. It compares `created_at` against the
  // journal's `when`; the hash is recorded but never re-checked.
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  )
  sqlite
    .prepare('INSERT INTO `__drizzle_migrations` ("hash", "created_at") VALUES (?, ?)')
    .run(createHash('sha256').update(migrationSql).digest('hex'), baseline.when)

  const now = new Date().toISOString()
  sqlite
    .prepare('INSERT INTO projects (id, name, repo_path, config, created_at) VALUES (?,?,?,?,?)')
    .run('p1', 'proj', '/tmp/proj', '{}', now)
  for (let i = 0; i < rows; i++) {
    sqlite
      .prepare(
        'INSERT INTO objectives (id, project_id, title, goal_text, worktree_path, branch_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(`o${i}`, 'p1', `title ${i}`, `goal ${i}`, `/tmp/wt/${i}`, `vadd/o${i}`, 'idle', now, now)
    sqlite
      .prepare(
        'INSERT INTO agent_sessions (id, objective_id, acp_session_id, status, started_at, ended_at) VALUES (?,?,?,?,?,?)',
      )
      .run(`s${i}`, `o${i}`, `acp-${i}`, 'ended', now, now)
  }
  sqlite.close()
}

test('migrations apply to a populated database at the 0000 baseline', () => {
  const home = withTempHome()
  const file = `${home}/vadd.db`
  seedAtBaseline(file, 3)

  const db = createDb(file)

  // Every row survives the `objectives` rebuilds in 0001, 0002 and 0003.
  expect(db.select().from(projects).all()).toHaveLength(1)
  expect(db.select().from(objectives).all()).toHaveLength(3)
  expect(db.select().from(agentSessions).all()).toHaveLength(3)
  // And the children still point at the parents they pointed at before.
  expect(
    db
      .select()
      .from(agentSessions)
      .all()
      .map((s) => s.objectiveId)
      .sort(),
  ).toEqual(['o0', 'o1', 'o2'])
  // The rebuilt table really is the post-0003 shape, not the baseline one.
  const migrated = db.select().from(objectives).all()[0]
  expect(migrated?.mode).toBe('standard')
  expect(migrated?.baseSha).toBeNull()
  expect(migrated?.integrateAction).toBeNull()
})

test('foreign keys are enforced again after migrating a populated database', () => {
  const home = withTempHome()
  const file = `${home}/vadd.db`
  seedAtBaseline(file, 1)
  createDb(file) // the upgrade boot, which turns enforcement off for the batch

  // Enforcement must be back on afterwards — on this connection and on every
  // later one — or writes silently lose the guarantee the schema declares.
  const db = createDb(file) // a steady-state boot, nothing pending
  expect(() =>
    db
      .insert(agentSessions)
      .values({
        id: 'dangling',
        objectiveId: 'no-such-objective',
        acpSessionId: 'acp-x',
        status: 'active',
        startedAt: new Date().toISOString(),
      })
      .run(),
  ).toThrow(/FOREIGN KEY constraint failed/)
})

test('a migration that leaves a dangling reference fails loudly', () => {
  const home = withTempHome()
  const file = `${home}/vadd.db`
  seedAtBaseline(file, 1)

  // A dangling reference: writable only with enforcement off, and `PRAGMA
  // foreign_keys = ON` never checks it retroactively. Migrating with
  // enforcement off could produce exactly this shape, so the post-migration
  // check must refuse rather than quietly re-enable enforcement over it.
  const sqlite = new Database(file)
  sqlite.pragma('foreign_keys = OFF')
  sqlite
    .prepare(
      'INSERT INTO agent_sessions (id, objective_id, acp_session_id, status, started_at, ended_at) VALUES (?,?,?,?,?,?)',
    )
    .run('orphan', 'gone', 'acp-orphan', 'ended', new Date().toISOString(), null)
  sqlite.close()

  expect(() => createDb(file)).toThrow(/foreign-key violation/)
})
