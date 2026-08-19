import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
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
}, 120_000)
