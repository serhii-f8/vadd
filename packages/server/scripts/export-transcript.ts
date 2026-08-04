import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { asc, eq } from 'drizzle-orm'
import { createDb } from '../src/db/client.js'
import { events } from '../src/db/schema.js'
import { dbPath } from '../src/paths.js'

const [objectiveId, nameArg] = process.argv.slice(2)
if (!objectiveId) {
  console.error('Usage: pnpm transcript:export <objectiveId> [name]')
  process.exit(1)
}

const db = createDb(dbPath())
const rows = db
  .select()
  .from(events)
  .where(eq(events.objectiveId, objectiveId))
  .orderBy(asc(events.id))
  .all()

if (rows.length === 0) {
  console.error(`No events found for objective ${objectiveId}`)
  process.exit(1)
}

// `pnpm --filter` runs this with cwd=packages/server, so process.cwd() would
// scatter transcripts into the package. Anchor to the repo root instead, which
// is a fixed two levels above this script's own directory.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const outDir = join(repoRoot, 'evals', 'transcripts')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, `${nameArg ?? objectiveId}.jsonl`)
writeFileSync(outFile, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)

const agentUpdates = rows.filter((r) => r.type === 'agent_update').length
console.log(`Wrote ${rows.length} events (${agentUpdates} agent updates) to ${outFile}`)
