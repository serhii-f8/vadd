import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { VerificationSpec } from '@vadd/core'

export type DetectionResult =
  | { kind: 'detected'; spec: VerificationSpec }
  | { kind: 'none'; scanned: string[] }

type Detected = { name: string; run: string; required: boolean }

/** Directories that never carry a project's own manifest. */
const SKIP = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', '.vadd'])

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    // A malformed manifest is "no signal here", not a crash. A malformed
    // *`.vadd/config.json`* is a different matter and refuses loudly — see
    // `resolve.ts`.
    return null
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Spec §6's order, applied within one directory. The first family that matches
 * wins — a repo with both `package.json` and a `Makefile` is a node project
 * with a convenience Makefile far more often than the reverse.
 */
function detectIn(dir: string): Detected[] {
  const pkg = readJson(join(dir, 'package.json'))
  if (pkg) {
    const scripts = (pkg.scripts ?? {}) as Record<string, string | undefined>
    const found: Detected[] = []
    for (const name of ['test', 'lint', 'build'] as const) {
      if (typeof scripts[name] === 'string') {
        found.push({ name, run: `npm run ${name}`, required: name !== 'build' })
      }
    }
    if (found.length > 0) return found
  }

  if (isFile(join(dir, 'composer.json'))) {
    const found: Detected[] = []
    if (isFile(join(dir, 'phpunit.xml')) || isFile(join(dir, 'phpunit.xml.dist'))) {
      found.push({ name: 'test', run: 'vendor/bin/phpunit', required: true })
    }
    if (isFile(join(dir, 'phpstan.neon')) || isFile(join(dir, 'phpstan.neon.dist'))) {
      found.push({ name: 'lint', run: 'vendor/bin/phpstan analyse', required: true })
    }
    if (found.length > 0) return found
  }

  if (isFile(join(dir, 'Makefile'))) return [{ name: 'test', run: 'make test', required: true }]
  if (isFile(join(dir, 'go.mod'))) return [{ name: 'test', run: 'go test ./...', required: true }]
  if (isFile(join(dir, 'Cargo.toml'))) return [{ name: 'test', run: 'cargo test', required: true }]

  return []
}

function subdirectories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Spec §6 / design §3.4: scan the root, then each immediate subdirectory —
 * **depth 1 only**, so a monorepo with no root manifest still resolves.
 *
 * Ids are namespaced by directory (`backend:test`) because `VerificationSpec`'s
 * own `.refine()` refuses duplicate ids, and two directories both yielding
 * `test` would otherwise produce a spec that fails its own schema. Root-level
 * ids stay bare.
 */
export function detectVerification(rootPath: string): DetectionResult {
  const scanned = ['.', ...subdirectories(rootPath)]
  const commands: VerificationSpec['verify']['commands'] = []

  for (const dir of scanned) {
    const abs = dir === '.' ? rootPath : join(rootPath, dir)
    for (const found of detectIn(abs)) {
      commands.push({
        id: dir === '.' ? found.name : `${dir}:${found.name}`,
        run: found.run,
        required: found.required,
        allowWarn: false,
        cwd: dir,
      })
    }
  }

  // Spec §6: "Detecting nothing is an explicit outcome, never an empty — and
  // therefore trivially green — command set."
  if (commands.length === 0) return { kind: 'none', scanned }

  return {
    kind: 'detected',
    spec: {
      verify: { setup: [], commands, checks: [], timeoutSec: 600 },
      policy: { protectedGlobs: [], maxFastFixLines: 150 },
    },
  }
}
