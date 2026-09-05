import { describe, expect, it } from 'vitest'
import type { ViewStateName } from '../src/focus/primary.js'
import { stateLabel } from '../src/focus/state-label.js'

/**
 * Listed inline rather than imported from `@vadd/core`'s barrel: the web
 * package reaches core only through `import type` or a browser-safe subpath,
 * and a test file is the wrong place to start an exception.
 */
const ALL: ViewStateName[] = [
  'idle',
  'creating',
  'exploring',
  'clarifying',
  'proposing',
  'awaitingDecision',
  'planning',
  'awaitingPlanApproval',
  'executing',
  'verifying',
  'awaitingReview',
  'revising',
  'rollingBack',
  'integrating',
  'done',
  'paused',
  'cancelled',
  'failed',
  'setup_failed',
]

describe('stateLabel', () => {
  it('is total and never echoes the machine name', () => {
    for (const s of ALL) {
      const label = stateLabel(s)
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toBe(s)
    }
  })

  it('says what the user has to do', () => {
    expect(stateLabel('awaitingPlanApproval')).toBe('Waiting for plan approval')
    expect(stateLabel('awaitingDecision')).toBe('Waiting for your decision')
    expect(stateLabel('awaitingReview')).toBe('Ready for your review')
    expect(stateLabel('cancelled')).toBe('Abandoned')
  })
})
