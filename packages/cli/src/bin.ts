#!/usr/bin/env node
import { resolveDefaults } from './resolve-defaults.js'

const here = import.meta.dirname
const defaults = resolveDefaults(here)
process.env.VADD_MIGRATIONS_DIR ??= defaults.migrationsDir
process.env.VADD_PROMPTS_DIR ??= defaults.promptsDir
process.env.VADD_WEB_DIST ??= defaults.webDist
// Indirection (rather than a static `import './server.js'`) so tsc doesn't
// resolve this against the TS source in packages/server/src (TS2307 at
// typecheck time) — server.js only exists post-build, next to this bundled
// file in dist/. Kept from Task 4's original fix.
const serverEntry = './server.js'
await import(serverEntry)
