import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentEventJsonSchema } from '../src/schemas/json-schema.js'

// Anchored to the repo root, not process.cwd(): `pnpm --filter` runs this with
// cwd=packages/core, which would scatter the output into the package.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const outDir = join(repoRoot, 'prompts', 'claude-code', 'v1')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'agent-event.schema.json')
writeFileSync(outFile, `${JSON.stringify(agentEventJsonSchema(), null, 2)}\n`)
console.log(`Wrote ${outFile}`)
