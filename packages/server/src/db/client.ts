import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

type Sqlite = InstanceType<typeof Database>

/** One row of `PRAGMA foreign_key_check` output. */
interface ForeignKeyViolation {
  table: string
  rowid: number | null
  parent: string
  fkid: number
}

export type Db = ReturnType<typeof createDb>

export function createDb(file: string) {
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  applyMigrations(sqlite, db)
  sqlite.pragma('foreign_keys = ON')
  return db
}

/**
 * Runs the pending migrations with foreign-key enforcement off, then proves the
 * result is still referentially consistent before turning enforcement back on.
 *
 * Migrations 0001, 0002 and 0003 rebuild `objectives` the way SQLite's own
 * 12-step ALTER procedure prescribes — create `__new_objectives`, copy, `DROP
 * TABLE objectives`, rename — because SQLite cannot add a CHECK constraint in
 * place. While the old table is gone, every `agent_sessions` row is a dangling
 * reference (`objective_id` is NOT NULL with no cascade), so the DROP is a
 * foreign-key violation.
 *
 * The generated SQL guards that with `PRAGMA foreign_keys=OFF`, but drizzle
 * wraps the entire pending batch in one `BEGIN`/`COMMIT`, and SQLite documents
 * that pragma as a **no-op inside a transaction**. Enforcement therefore stayed
 * on and `DROP TABLE objectives` failed with `FOREIGN KEY constraint failed` —
 * unbootable for any installation that had ever run an objective. Empty test
 * databases have no child rows to violate, which is why the suite never saw it.
 * The pragma has to be set out here, before drizzle opens its transaction.
 *
 * `PRAGMA defer_foreign_keys` is not an alternative: DROP TABLE's implicit
 * delete is checked immediately rather than deferred to COMMIT, and the same
 * migration was measured failing identically with it set.
 *
 * The check afterwards is step 11 of SQLite's procedure, and it runs only when
 * migrations were actually applied — a normal boot with nothing pending never
 * pays for it and can never be blocked by it. That also bounds the blast radius
 * of a failure to the one boot that performed the upgrade: the batch has
 * already committed, so the next boot has nothing pending, skips the check, and
 * starts. The point is to refuse to *silently* resume enforcing constraints the
 * data no longer satisfies.
 */
function applyMigrations(sqlite: Sqlite, db: ReturnType<typeof drizzle<typeof schema>>): void {
  sqlite.pragma('foreign_keys = OFF')
  const before = appliedMigrationCount(sqlite)
  migrate(db, { migrationsFolder })
  if (appliedMigrationCount(sqlite) > before) assertNoDanglingReferences(sqlite)
}

/** How many migrations drizzle has recorded; 0 before it creates its table. */
function appliedMigrationCount(sqlite: Sqlite): number {
  const table = sqlite
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get() as { n: number }
  if (table.n === 0) return 0
  return (sqlite.prepare('SELECT count(*) AS n FROM `__drizzle_migrations`').get() as { n: number })
    .n
}

function assertNoDanglingReferences(sqlite: Sqlite): void {
  const violations = sqlite.pragma('foreign_key_check') as ForeignKeyViolation[]
  if (violations.length === 0) return
  const detail = violations
    .slice(0, 10)
    .map((v) => `${v.table} rowid ${v.rowid ?? '?'} -> ${v.parent} (fk ${v.fkid})`)
    .join('; ')
  throw new Error(
    `Migrations left ${violations.length} foreign-key violation(s) in ${sqlite.name}; ` +
      `refusing to re-enable enforcement over inconsistent data: ${detail}`,
  )
}
