import { describe, expect, it } from 'vitest'
import type { ViewStateName } from '../src/focus/primary.js'
import { stateColor } from '../src/routes/stateColor.js'

describe('stateColor', () => {
  it('maps idle and creating to gray', () => {
    expect(stateColor('idle')).toBe('bg-gray-400')
    expect(stateColor('creating')).toBe('bg-gray-400')
  })

  it('maps every "working" state to blue', () => {
    const working: ViewStateName[] = [
      'exploring',
      'proposing',
      'planning',
      'executing',
      'verifying',
      'revising',
      'rollingBack',
      'integrating',
    ]
    for (const s of working) expect(stateColor(s)).toBe('bg-blue-500')
  })

  it('maps every "needs you" state to amber', () => {
    const needsYou: ViewStateName[] = [
      'awaitingDecision',
      'clarifying',
      'awaitingPlanApproval',
      'awaitingReview',
      'paused',
    ]
    for (const s of needsYou) expect(stateColor(s)).toBe('bg-amber-500')
  })

  it('maps done to green', () => {
    expect(stateColor('done')).toBe('bg-green-500')
  })

  it('maps failed/cancelled/setup_failed to red', () => {
    expect(stateColor('cancelled')).toBe('bg-red-500')
    expect(stateColor('failed')).toBe('bg-red-500')
    expect(stateColor('setup_failed')).toBe('bg-red-500')
  })
})
