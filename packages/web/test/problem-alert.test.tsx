import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProblemAlert, problemLabel } from '../src/focus/ProblemAlert.js'

describe('problemLabel', () => {
  it('explains the failure a stalled objective actually hits', () => {
    // The real case: an objective in a repo with no auto-detectable
    // verification spec bounces `verifying → paused` forever, and the raw
    // event type alone tells a user nothing about what to do.
    expect(problemLabel('verification_unresolved')).toBe('No verification spec could be resolved')
  })

  it('falls back to the raw event type it does not have wording for', () => {
    // Better a bare type than a blank alert: every problem type is worth
    // showing, and the list of them grows independently of this map.
    expect(problemLabel('some_future_failure')).toBe('some_future_failure')
  })
})

describe('ProblemAlert', () => {
  it('shows the explanation and the underlying message', () => {
    render(
      <ProblemAlert
        problem={{
          type: 'record_plan_failed',
          message: 'UNIQUE constraint failed: plan_tasks.id',
          at: '2026-08-23T10:25:23.044Z',
        }}
      />,
    )
    expect(screen.getByText(/Could not record the plan/)).toBeTruthy()
    expect(screen.getByText('UNIQUE constraint failed: plan_tasks.id')).toBeTruthy()
  })

  it('renders without a message, because not every failure payload carries one', () => {
    // `verification_unresolved` is emitted with `{ scanned }` and no message
    // at all — the exact type most likely to be showing.
    render(
      <ProblemAlert
        problem={{ type: 'verification_unresolved', message: null, at: '2026-08-23T10:25:23.044Z' }}
      />,
    )
    expect(screen.getByText(/No verification spec could be resolved/)).toBeTruthy()
  })

  it('says when the problem happened', () => {
    // A stale problem from an hour ago must not read as one from just now.
    // `<time>` has no ARIA role, so this queries the element directly.
    const { container } = render(
      <ProblemAlert
        problem={{ type: 'verification_unresolved', message: null, at: '2026-08-23T10:25:23.044Z' }}
      />,
    )
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-08-23T10:25:23.044Z',
    )
  })
})
