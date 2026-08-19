#!/usr/bin/env node
import { join } from 'node:path'

export function resolveDefaults(here: string) {
  return {
    migrationsDir: join(here, 'migrations'),
    promptsDir: join(here, 'prompts', 'claude-code', 'v1'),
    webDist: join(here, 'web'),
  }
}

async function main() {
  const here = import.meta.dirname
  const defaults = resolveDefaults(here)
  process.env.VADD_MIGRATIONS_DIR ??= defaults.migrationsDir
  process.env.VADD_PROMPTS_DIR ??= defaults.promptsDir
  process.env.VADD_WEB_DIST ??= defaults.webDist
  const serverEntry = './server.js'
  await import(serverEntry)
}

// Guard so the packaging test in Task 6 can import resolveDefaults without
// also booting a real server as a side effect of the import.
if (process.argv[1] === import.meta.filename) {
  await main()
}
