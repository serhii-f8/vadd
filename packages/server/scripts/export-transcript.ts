import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { createDb } from '../src/db/client.js'
import { events } from '../src/db/schema.js'
import { TRANSCRIPT_SCHEMA_VERSION } from '../src/evals/transcript.js'
import { dbPath, repoRoot, vaddHome } from '../src/paths.js'

const [objectiveId, nameArg] = process.argv.slice(2)
if (!objectiveId) {
  console.error('Usage: pnpm transcript:export <objectiveId> [name]')
  process.exit(1)
}

// A name is a filename, not a path. Without this, `../../pwned` writes outside
// the anchored output directory and silently clobbers whatever is there.
if (
  nameArg !== undefined &&
  (nameArg.includes('/') || nameArg.includes('\\') || nameArg === '..')
) {
  console.error(`Invalid name "${nameArg}": it must be a plain filename, with no path separators.`)
  process.exit(1)
}

// createDb() CREATES and migrates an empty database when none exists, so a
// wrong or unset VADD_HOME would otherwise report "no events found" — which
// reads as a bad objective id rather than as the wrong home directory.
if (!existsSync(dbPath())) {
  console.error(
    `No VADD database at ${dbPath()}. Set VADD_HOME if your state lives elsewhere ` +
      `(currently ${vaddHome()}), or start the server once to create it.`,
  )
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
// scatter transcripts into the package. Anchor to the repo root instead, found
// by walking up for the pnpm-workspace.yaml marker (see paths.ts) rather than a
// fixed `..` count, which only holds while this script runs unbuilt from src/.
const outDir = join(repoRoot(), 'evals', 'transcripts')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, `${nameArg ?? objectiveId}.jsonl`)

// Approximate provenance: HEAD at export time. Exact when a transcript is
// exported promptly after recording, wrong if a corpus is re-exported later.
// The eval reports it and never gates on it, so an unavailable value degrades
// to "unstamped" rather than to a failed export.
let recordedUnder: string | undefined
try {
  recordedUnder = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot(),
    encoding: 'utf8',
  }).trim()
} catch {
  recordedUnder = undefined
}

// Stamped per record, not as a header line: every consumer reads this file line
// by line, and a header would make each of them special-case line 1.
writeFileSync(
  outFile,
  `${rows
    .map((r) =>
      JSON.stringify({
        ...r,
        schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
        ...(recordedUnder === undefined ? {} : { recordedUnder }),
      }),
    )
    .join('\n')}\n`,
)

const agentUpdates = rows.filter((r) => r.type === 'agent_update').length
console.log(`Wrote ${rows.length} events (${agentUpdates} agent updates) to ${outFile}`)
