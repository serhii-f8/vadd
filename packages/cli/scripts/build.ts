import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(cliRoot, '..', '..')
const dist = join(cliRoot, 'dist')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

// Real npm dependencies that must stay resolvable from node_modules at
// runtime rather than be inlined — better-sqlite3 (native) and
// @zed-industries/claude-code-acp (resolved by real path at runtime, see
// acp-agent-port.ts) are the two that *must* stay external; the rest follow
// for the same reason (no upside to inlining a real published package).
// Sourced from this package's own package.json rather than hand-duplicated,
// since that's the exact allowlist Task 4 declared as `dependencies` for
// this purpose. `packages: 'external'` was tried first and rejected: it
// marks *every* bare-specifier import external, including the workspace
// package `@vadd/core` (a plain node_modules symlink, no tsconfig path
// mapping resolves it to source) — so server.js kept an unresolvable
// `import "@vadd/core"` and crashed with ERR_MODULE_NOT_FOUND on the very
// first run outside the monorepo, confirmed by hand before switching to this
// explicit list. `@vadd/core` and its own `zod-to-json-schema` dependency
// (not in this external list) get bundled into server.js instead, matching
// the intended "bundles @vadd/core's and @vadd/server's own source into one
// file" design.
const cliPackageJson = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
}
const external = Object.keys(cliPackageJson.dependencies)

// 1. Bundle the server (and, through it, core) into one file.
await esbuild.build({
  entryPoints: [join(repoRoot, 'packages/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external,
  outfile: join(dist, 'server.js'),
})

// 2. Bundle bin.ts the same way. No `banner`: src/bin.ts (Task 4) already
// carries its own leading `#!/usr/bin/env node`, and esbuild auto-detects and
// preserves an entry file's own shebang in its output — adding a banner on
// top duplicated it as an invalid second line and crashed dist/bin.js with a
// SyntaxError on the very first `node dist/bin.js` (confirmed by hand before
// removing this).
await esbuild.build({
  entryPoints: [join(cliRoot, 'src/bin.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external,
  outfile: join(dist, 'bin.js'),
})
chmodSync(join(dist, 'bin.js'), 0o755)

// 3. Build the web assets with the workspace's own existing build script.
execFileSync('pnpm', ['--filter', '@vadd/web', 'build'], { cwd: repoRoot, stdio: 'inherit' })
cpSync(join(repoRoot, 'packages/web/dist'), join(dist, 'web'), { recursive: true })

// 4. Copy migrations and prompt templates as plain data — never bundled,
// read from disk at runtime by createDb()/bundledPromptDir() (Tasks 1-2).
cpSync(join(repoRoot, 'packages/server/drizzle'), join(dist, 'migrations'), { recursive: true })
const promptsSrc = join(repoRoot, 'prompts/claude-code/v1')
if (!existsSync(promptsSrc)) {
  throw new Error(`Expected prompt templates at ${promptsSrc} — build cannot continue`)
}
cpSync(promptsSrc, join(dist, 'prompts/claude-code/v1'), { recursive: true })

console.log('packages/cli build complete:', dist)
