import { describe, expect, it } from 'vitest'
import { evidenceComplete, isFastFix, userApproved } from '../src/machine/guards.js'
import type { EvidenceItemLike, WorkflowContext } from '../src/machine/types.js'
import { VerificationSpec } from '../src/schemas/verification.js'

const spec = VerificationSpec.parse({
  verify: {
    commands: [
      { id: 'test', run: 'pnpm test', required: true },
      { id: 'lint', run: 'pnpm lint', required: true, allowWarn: true },
      { id: 'build', run: 'pnpm build', required: false },
    ],
    checks: ['Repro test exists'],
  },
})

function item(over: Partial<EvidenceItemLike>): EvidenceItemLike {
  return { commandId: null, kind: 'test', status: 'pass', taskId: null, ...over }
}

const green: EvidenceItemLike[] = [
  item({ commandId: 'test', kind: 'test', status: 'pass' }),
  item({ commandId: 'lint', kind: 'lint', status: 'pass' }),
  item({ commandId: 'check-0', kind: 'check', status: 'pass' }),
]

describe('evidenceComplete', () => {
  it('is true when every required command and every check is green', () => {
    expect(evidenceComplete(spec, green)).toBe(true)
  })

  it('is false when a required command has no evidence at all', () => {
    expect(
      evidenceComplete(
        spec,
        green.filter((i) => i.commandId !== 'test'),
      ),
    ).toBe(false)
  })

  it('is false when a required command failed', () => {
    const red = green.map((i) => (i.commandId === 'test' ? { ...i, status: 'fail' as const } : i))
    expect(evidenceComplete(spec, red)).toBe(false)
  })

  it('accepts warn only where the item sets allowWarn', () => {
    const lintWarn = green.map((i) =>
      i.commandId === 'lint' ? { ...i, status: 'warn' as const } : i,
    )
    expect(evidenceComplete(spec, lintWarn)).toBe(true)
    const testWarn = green.map((i) =>
      i.commandId === 'test' ? { ...i, status: 'warn' as const } : i,
    )
    expect(evidenceComplete(spec, testWarn)).toBe(false)
  })

  it('ignores optional commands entirely', () => {
    const buildFailed = [...green, item({ commandId: 'build', kind: 'build', status: 'fail' })]
    expect(evidenceComplete(spec, buildFailed)).toBe(true)
  })

  it('is false when a check is unsatisfied', () => {
    expect(
      evidenceComplete(
        spec,
        green.filter((i) => i.commandId !== 'check-0'),
      ),
    ).toBe(false)
  })

  it('is false with no spec at all — unproven is never green', () => {
    expect(evidenceComplete(null, green)).toBe(false)
  })

  it('is false for a spec with no required command and no check', () => {
    const empty = VerificationSpec.parse({
      verify: { commands: [{ id: 'build', run: 'x', required: false }] },
    })
    expect(evidenceComplete(empty, [])).toBe(false)
  })

  it('ignores evidence with no commandId — agent claims do not close an item', () => {
    const agentOnly = [item({ commandId: null, kind: 'test', status: 'pass' })]
    expect(evidenceComplete(spec, agentOnly)).toBe(false)
  })
})

describe('evidenceComplete with a declared expectFailing (A11)', () => {
  it('tolerates a fail on exactly the declared command id', () => {
    const items = [
      item({ commandId: 'test', kind: 'test', status: 'fail' }),
      item({ commandId: 'lint', kind: 'lint', status: 'pass' }),
      item({ commandId: 'check-0', kind: 'check', status: 'pass' }),
    ]
    expect(evidenceComplete(spec, items, ['test'])).toBe(true)
  })

  it('still refuses when a DIFFERENT required command fails, even with an exemption declared', () => {
    const items = [
      item({ commandId: 'test', kind: 'test', status: 'fail' }),
      item({ commandId: 'lint', kind: 'lint', status: 'fail' }),
      item({ commandId: 'check-0', kind: 'check', status: 'pass' }),
    ]
    // Only "test" was declared expected-red; "lint" failing is unexpected.
    expect(evidenceComplete(spec, items, ['test'])).toBe(false)
  })

  it('has no effect when omitted — today\'s strict behaviour is unchanged', () => {
    const items = [
      item({ commandId: 'test', kind: 'test', status: 'fail' }),
      item({ commandId: 'lint', kind: 'lint', status: 'pass' }),
      item({ commandId: 'check-0', kind: 'check', status: 'pass' }),
    ]
    expect(evidenceComplete(spec, items)).toBe(false)
    expect(evidenceComplete(spec, items, [])).toBe(false)
  })

  it('does not let expectFailing substitute for allowWarn, or vice versa', () => {
    // "lint" has allowWarn: true in the shared `spec` fixture. A `fail` status
    // on it is not the same as a `warn` status, and declaring it in
    // expectFailing is what makes a fail tolerated — allowWarn alone does not.
    const items = [
      item({ commandId: 'test', kind: 'test', status: 'pass' }),
      item({ commandId: 'lint', kind: 'lint', status: 'fail' }),
      item({ commandId: 'check-0', kind: 'check', status: 'pass' }),
    ]
    expect(evidenceComplete(spec, items)).toBe(false)
    expect(evidenceComplete(spec, items, ['lint'])).toBe(true)
  })
})

const ctx = (over: Partial<WorkflowContext>): WorkflowContext =>
  ({
    objectiveId: 'o',
    mode: 'standard',
    lowEnergy: false,
    goalText: 'g',
    verificationSpec: null,
    tasks: [],
    currentTaskIndex: 0,
    evidence: [],
    verificationRunId: null,
    verificationEpoch: null,
    approvals: [],
    pendingDecisionId: null,
    pendingClarification: null,
    turnEvents: [],
    lastFailure: null,
    resumeState: null,
    reviseInstruction: null,
    ...over,
  }) satisfies WorkflowContext

describe('userApproved', () => {
  it('is true only for a key that was explicitly approved', () => {
    expect(userApproved(ctx({ approvals: ['plan'] }), 'plan')).toBe(true)
    expect(userApproved(ctx({ approvals: ['plan'] }), 'task:0')).toBe(false)
    expect(userApproved(ctx({}), 'plan')).toBe(false)
  })
})

describe('isFastFix', () => {
  it('reads mode and nothing else', () => {
    expect(isFastFix(ctx({ mode: 'fastfix' }))).toBe(true)
    expect(isFastFix(ctx({ mode: 'standard' }))).toBe(false)
    expect(isFastFix(ctx({ mode: 'standard', lowEnergy: true }))).toBe(false)
  })
})
