import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { resolveVerification } from '../src/verification/resolve.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vadd-resolve-'))
})

function writeConfig(contents: string): void {
  mkdirSync(join(root, '.vadd'), { recursive: true })
  writeFileSync(join(root, '.vadd', 'config.json'), contents)
}

const CONFIG = JSON.stringify({
  verify: {
    commands: [{ id: 'test', run: 'phpunit', required: true }],
    checks: ['Bug reproduced by a failing-then-passing test'],
  },
})

describe('resolveVerification', () => {
  it('prefers a committed config over detection', () => {
    writeConfig(CONFIG)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    const result = resolveVerification(root, null)
    expect(result.kind).toBe('resolved')
    if (result.kind !== 'resolved') return
    expect(result.source).toBe('config')
    expect(result.spec.verify.commands[0]?.run).toBe('phpunit')
  })

  it('applies schema defaults to a sparse config', () => {
    writeConfig(CONFIG)
    const result = resolveVerification(root, null)
    if (result.kind !== 'resolved') throw new Error('expected resolution')
    expect(result.spec.verify.commands[0]?.cwd).toBe('.')
    expect(result.spec.verify.commands[0]?.allowWarn).toBe(false)
    expect(result.spec.verify.timeoutSec).toBe(600)
    expect(result.spec.verify.setup).toEqual([])
  })

  it('falls back to detection when there is no config', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    const result = resolveVerification(root, null)
    if (result.kind !== 'resolved') throw new Error('expected resolution')
    expect(result.source).toBe('detected')
  })

  it('refuses a malformed config rather than silently detecting', () => {
    writeConfig('{ not json')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    const result = resolveVerification(root, null)
    expect(result.kind).toBe('invalid')
    if (result.kind !== 'invalid') return
    expect(result.reason).toMatch(/config\.json/)
  })

  it('refuses a config that fails schema validation, naming the rule', () => {
    writeConfig(
      JSON.stringify({
        verify: {
          commands: [
            { id: 'test', run: 'a', required: true },
            { id: 'test', run: 'b', required: true },
          ],
        },
      }),
    )
    const result = resolveVerification(root, null)
    expect(result.kind).toBe('invalid')
    if (result.kind !== 'invalid') return
    expect(result.reason).toMatch(/unique/i)
  })

  it('merges an override on top of a config', () => {
    writeConfig(CONFIG)
    const result = resolveVerification(root, { verify: { timeoutSec: 30 } })
    if (result.kind !== 'resolved') throw new Error('expected resolution')
    expect(result.spec.verify.timeoutSec).toBe(30)
    expect(result.spec.verify.commands[0]?.run).toBe('phpunit')
  })

  it('merges an override on top of detection', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    const result = resolveVerification(root, {
      verify: { checks: ['Reviewed by hand'] },
    })
    if (result.kind !== 'resolved') throw new Error('expected resolution')
    expect(result.spec.verify.checks).toEqual(['Reviewed by hand'])
  })

  it('an override alone resolves even when nothing is detected', () => {
    const result = resolveVerification(root, {
      verify: {
        commands: [{ id: 'test', run: 'make test', required: true, allowWarn: false, cwd: '.' }],
      },
    })
    expect(result.kind).toBe('resolved')
  })

  it('reports none when there is no config, no detection and no override', () => {
    const result = resolveVerification(root, null)
    expect(result.kind).toBe('none')
    if (result.kind !== 'none') return
    expect(result.scanned).toContain('.')
  })

  it('an override that resolves to nothing required stays honest', () => {
    // The guard refuses a spec with nothing required and no checks; the
    // resolver's job is only to produce it faithfully, not to reject it.
    const result = resolveVerification(root, { verify: { commands: [], checks: [] } })
    expect(result.kind).toBe('none')
  })
})
