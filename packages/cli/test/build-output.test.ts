import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cliRoot = fileURLToPath(new URL('..', import.meta.url))

describe('packages/cli build', () => {
  it('produces every artifact bin.ts needs at its default paths', () => {
    execFileSync('pnpm', ['run', 'build'], { cwd: cliRoot, stdio: 'inherit' })

    const dist = join(cliRoot, 'dist')
    expect(existsSync(join(dist, 'server.js'))).toBe(true)
    expect(existsSync(join(dist, 'bin.js'))).toBe(true)
    expect(existsSync(join(dist, 'migrations', 'meta', '_journal.json'))).toBe(true)
    expect(existsSync(join(dist, 'prompts', 'claude-code', 'v1'))).toBe(true)
    expect(existsSync(join(dist, 'web', 'index.html'))).toBe(true)

    // Executable bit, since npm respects it verbatim from the published tarball
    // and a non-executable bin.js fails with EACCES on the very first `npx` run.
    const mode = statSync(join(dist, 'bin.js')).mode
    expect(mode & 0o111).not.toBe(0)
  })

  it('neither ACP adapter package is statically imported into the bundle', () => {
    // resolveAdapterBin() reaches these purely via import.meta.resolve() at
    // runtime (packageName is a plain string on AgentKindConfig) — an actual
    // `import`/`require` of either package would mean esbuild inlined it,
    // which must never happen (better-sqlite3-style native/runtime-resolved
    // packages stay external by construction, see scripts/build.ts's own
    // comment). The package names legitimately appear elsewhere in the
    // bundle as plain string content (each config's own error message), so
    // this checks specifically for import/require syntax, not mere presence.
    const serverJs = readFileSync(join(cliRoot, 'dist', 'server.js'), 'utf8')
    expect(serverJs).not.toMatch(/(?:from\s*["']|require\(["'])@zed-industries\/claude-code-acp/)
    expect(serverJs).not.toMatch(/(?:from\s*["']|require\(["'])@agentclientprotocol\/codex-acp/)
  })

  it('@agentclientprotocol/codex-acp is a real, declared packages/cli dependency', () => {
    // Not a resolution check via import.meta.resolve() from inside this test
    // file: Node's resolution walks up the directory tree and would find the
    // package via the monorepo root's own devDependency regardless of
    // whether packages/cli declares it — that gave a false pass in exactly
    // this scenario during development. The only thing that actually proves
    // "bundled into packages/cli" is the manifest itself; the real,
    // filesystem-isolated proof is the smoke test (`pnpm --filter @vadd/cli
    // smoke`), which packs and installs the tarball completely outside this
    // monorepo — not run here since it's real, slow, and gated the same way
    // the rest of this project's smoke test always has been.
    const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies).toHaveProperty('@agentclientprotocol/codex-acp')
  })
}, 120_000)
