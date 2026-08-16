import { MACHINE_STATES } from '@vadd/core'
import { describe, expect, it } from 'vitest'
import { primaryElementFor } from '../src/focus/primary.js'

describe('primaryElementFor', () => {
  it('maps every machine state — a new state with no mapping fails here', () => {
    for (const state of MACHINE_STATES) {
      expect(() => primaryElementFor(state)).not.toThrow()
      expect(primaryElementFor(state)).toBeTruthy()
    }
  })

  it('puts a decision in front of the user only where one is pending', () => {
    expect(primaryElementFor('awaitingDecision')).toBe('decision')
    expect(primaryElementFor('clarifying')).toBe('decision')
    expect(primaryElementFor('proposing')).toBe('live')
  })

  it('shows the plan only while it awaits approval', () => {
    expect(primaryElementFor('awaitingPlanApproval')).toBe('plan')
    expect(primaryElementFor('planning')).toBe('live')
  })

  it('shows a live card for every state where the agent is working', () => {
    for (const state of [
      'exploring',
      'proposing',
      'planning',
      'executing',
      'verifying',
      'revising',
      'rollingBack',
    ] as const) {
      expect(primaryElementFor(state)).toBe('live')
    }
  })

  it('offers the integration chooser only in integrating', () => {
    expect(primaryElementFor('integrating')).toBe('integration')
    expect(primaryElementFor('awaitingReview')).toBe('review')
    expect(primaryElementFor('done')).toBe('outcome')
  })

  it('treats all three terminal states as an outcome', () => {
    for (const state of ['done', 'cancelled', 'failed'] as const) {
      expect(primaryElementFor(state)).toBe('outcome')
    }
  })

  it('offers resume from idle and paused', () => {
    expect(primaryElementFor('idle')).toBe('resume')
    expect(primaryElementFor('paused')).toBe('resume')
  })
})
