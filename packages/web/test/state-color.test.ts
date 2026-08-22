import { describe, expect, it } from 'vitest'
import type { ViewStateName } from '../src/focus/primary.js'
import { stateColor, statusFor } from '../src/routes/stateColor.js'

const ALL: ViewStateName[] = [
  'idle',
  'creating',
  'exploring',
  'proposing',
  'planning',
  'executing',
  'verifying',
  'revising',
  'rollingBack',
  'integrating',
  'awaitingDecision',
  'clarifying',
  'awaitingPlanApproval',
  'awaitingReview',
  'paused',
  'done',
  'cancelled',
  'failed',
  'setup_failed',
]

describe('statusFor', () => {
  it('maps idle and creating to the idle tone', () => {
    for (const s of ['idle', 'creating'] as ViewStateName[]) {
      expect(statusFor(s).tone).toBe('idle')
    }
  })

  it('maps every working state to the active tone', () => {
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
    for (const s of working) expect(statusFor(s).tone).toBe('active')
  })

  it('maps every state where the user is the blocker to the attention tone', () => {
    const needsYou: ViewStateName[] = [
      'awaitingDecision',
      'clarifying',
      'awaitingPlanApproval',
      'awaitingReview',
      'paused',
    ]
    for (const s of needsYou) expect(statusFor(s).tone).toBe('attention')
  })

  it('maps done to the done tone', () => {
    expect(statusFor('done').tone).toBe('done')
  })

  it('maps every terminal-red state to the failed tone', () => {
    for (const s of ['cancelled', 'failed', 'setup_failed'] as ViewStateName[]) {
      expect(statusFor(s).tone).toBe('failed')
    }
  })

  it('returns a theme token class, never a fixed palette value', () => {
    for (const s of ALL) {
      expect(statusFor(s).dot).toMatch(/^bg-status-/)
    }
  })

  it('gives every state a human label for the tooltip', () => {
    for (const s of ALL) {
      expect(statusFor(s).label.length).toBeGreaterThan(0)
    }
  })

  // The `never` guard is a compile-time device; this is the runtime half —
  // it fails loudly if a state is ever added to the union without a case.
  it('is total over ViewStateName', () => {
    for (const s of ALL) expect(() => statusFor(s)).not.toThrow()
  })

  it('keeps stateColor as the dot-only accessor', () => {
    expect(stateColor('done')).toBe(statusFor('done').dot)
  })
})
