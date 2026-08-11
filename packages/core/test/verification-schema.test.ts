import { describe, expect, it } from 'vitest'
import { normalizeChecks, VerificationSpec } from '../src/schemas/verification.js'

const full = {
  verify: {
    setup: [{ id: 'deps', run: 'composer install', cwd: 'backend' }],
    commands: [
      { id: 'test', run: 'pnpm test', required: true },
      { id: 'lint', run: 'pnpm lint', required: true, allowWarn: true },
      { id: 'build', run: 'pnpm build', required: false, cwd: 'frontend' },
    ],
    checks: ['Bug is reproduced by a new failing-then-passing test'],
    timeoutSec: 600,
  },
  policy: { protectedGlobs: ['**/migrations/**'], maxFastFixLines: 150 },
}

describe('VerificationSpec', () => {
  it('accepts spec §6 verbatim', () => {
    expect(VerificationSpec.safeParse(full).success).toBe(true)
  })

  it('defaults cwd to "." and allowWarn to false', () => {
    const parsed = VerificationSpec.parse(full)
    expect(parsed.verify.commands[0]?.cwd).toBe('.')
    expect(parsed.verify.commands[0]?.allowWarn).toBe(false)
  })

  it('defaults timeoutSec to 600 and setup/checks to empty', () => {
    const parsed = VerificationSpec.parse({
      verify: { commands: [{ id: 'test', run: 'pnpm test', required: true }] },
    })
    expect(parsed.verify.timeoutSec).toBe(600)
    expect(parsed.verify.setup).toEqual([])
    expect(parsed.verify.checks).toEqual([])
  })

  it('rejects duplicate command ids — evidence could not be attributed', () => {
    const dup = {
      verify: {
        commands: [
          { id: 'test', run: 'a', required: true },
          { id: 'test', run: 'b', required: true },
        ],
      },
    }
    expect(VerificationSpec.safeParse(dup).success).toBe(false)
  })

  it('derives positional ids for checks (amendment A5)', () => {
    expect(normalizeChecks(VerificationSpec.parse(full))).toEqual([
      { id: 'check-0', text: 'Bug is reproduced by a new failing-then-passing test' },
    ])
  })
})
