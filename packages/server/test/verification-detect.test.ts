import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VerificationSpec } from '@vadd/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { detectVerification } from '../src/verification/detect.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vadd-detect-'))
})

function write(rel: string, contents: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents)
}

describe('detectVerification', () => {
  it('reads package.json scripts at the root, bare ids', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest', lint: 'biome check .' } }))
    const result = detectVerification(root)
    expect(result.kind).toBe('detected')
    if (result.kind !== 'detected') return
    expect(result.spec.verify.commands.map((c) => c.id)).toEqual(['test', 'lint'])
    expect(result.spec.verify.commands[0]?.run).toBe('npm run test')
    expect(result.spec.verify.commands[0]?.cwd).toBe('.')
  })

  it('marks test and lint required, build not', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'v', lint: 'b', build: 'tsc' } }))
    const result = detectVerification(root)
    if (result.kind !== 'detected') throw new Error('expected detection')
    const byId = Object.fromEntries(result.spec.verify.commands.map((c) => [c.id, c]))
    expect(byId.test?.required).toBe(true)
    expect(byId.lint?.required).toBe(true)
    expect(byId.build?.required).toBe(false)
  })

  it('namespaces subdirectory ids so a monorepo with no root manifest resolves', () => {
    write('backend/composer.json', '{}')
    write('backend/phpunit.xml', '<phpunit/>')
    write('frontend/package.json', JSON.stringify({ scripts: { lint: 'eslint .' } }))
    const result = detectVerification(root)
    if (result.kind !== 'detected') throw new Error('expected detection')
    const ids = result.spec.verify.commands.map((c) => c.id).sort()
    expect(ids).toEqual(['backend:test', 'frontend:lint'])
    const backend = result.spec.verify.commands.find((c) => c.id === 'backend:test')
    expect(backend?.cwd).toBe('backend')
  })

  it('produces a spec that satisfies its own schema, ids unique', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'v' } }))
    write('backend/package.json', JSON.stringify({ scripts: { test: 'v' } }))
    const result = detectVerification(root)
    if (result.kind !== 'detected') throw new Error('expected detection')
    const ids = result.spec.verify.commands.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(VerificationSpec.safeParse(result.spec).success).toBe(true)
  })

  it('stops at depth 1 — a manifest two levels down is not detected', () => {
    write('packages/core/package.json', JSON.stringify({ scripts: { test: 'v' } }))
    const result = detectVerification(root)
    expect(result.kind).toBe('none')
  })

  it('finding nothing is an explicit outcome naming what was scanned', () => {
    mkdirSync(join(root, 'docs'))
    const result = detectVerification(root)
    expect(result.kind).toBe('none')
    if (result.kind !== 'none') return
    expect(result.scanned).toContain('.')
    expect(result.scanned).toContain('docs')
  })

  it('never returns an empty command set as a detection', () => {
    const result = detectVerification(root)
    expect(result.kind).not.toBe('detected')
  })

  it('falls through package.json to composer, Makefile, go.mod, Cargo.toml in order', () => {
    write('go.mod', 'module x\n')
    const result = detectVerification(root)
    if (result.kind !== 'detected') throw new Error('expected detection')
    expect(result.spec.verify.commands[0]?.run).toBe('go test ./...')
  })

  it('ignores node_modules, .git and vendor when scanning subdirectories', () => {
    write('node_modules/x/package.json', JSON.stringify({ scripts: { test: 'v' } }))
    write('vendor/y/package.json', JSON.stringify({ scripts: { test: 'v' } }))
    const result = detectVerification(root)
    expect(result.kind).toBe('none')
  })

  it('survives a malformed package.json rather than throwing', () => {
    write('package.json', '{ not json')
    expect(() => detectVerification(root)).not.toThrow()
  })
})
