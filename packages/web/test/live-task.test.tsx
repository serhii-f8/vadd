import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PlanTask } from '../src/api.js'
import { formatElapsed } from '../src/focus/elapsed.js'
import { LiveTask } from '../src/focus/LiveTask.js'

function task(over: Partial<PlanTask> & { ord: number }): PlanTask {
  return {
    id: `t${over.ord}`,
    title: `Task ${over.ord}`,
    description: 'd',
    status: 'pending',
    expectFailing: null,
    startedAt: null,
    finishedAt: null,
    checkpointRef: null,
    ...over,
  }
}

describe('formatElapsed', () => {
  it('counts seconds under a minute', () => {
    expect(formatElapsed('2026-08-23T10:00:00.000Z', Date.parse('2026-08-23T10:00:07.000Z'))).toBe(
      '7s',
    )
  })

  it('counts minutes and seconds past a minute', () => {
    expect(formatElapsed('2026-08-23T10:00:00.000Z', Date.parse('2026-08-23T10:02:05.000Z'))).toBe(
      '2m 05s',
    )
  })

  it('counts hours past an hour', () => {
    expect(formatElapsed('2026-08-23T10:00:00.000Z', Date.parse('2026-08-23T11:30:00.000Z'))).toBe(
      '1h 30m',
    )
  })

  it('clamps a startedAt in the future to zero rather than showing a negative', () => {
    expect(formatElapsed('2026-08-23T10:00:10.000Z', Date.parse('2026-08-23T10:00:00.000Z'))).toBe(
      '0s',
    )
  })
})

describe('LiveTask', () => {
  it('shows the running task title', () => {
    render(
      <LiveTask
        tasks={[task({ ord: 0, status: 'verified' }), task({ ord: 1, status: 'running' })]}
        lastStatus={null}
        lastAgentUpdateAt={null}
      />,
    )
    expect(screen.getByRole('heading').textContent).toBe('Task 1')
  })

  /**
   * The defect this component had: with nothing `running`, it fell back to
   * `tasks.find(t => t.status !== 'verified')` and rendered a task that has not
   * started as though it were the live one — a user hovering the dot strip saw
   * "<a future task> — pending" and could not tell what was actually happening.
   */
  it('never presents a task that has not started as the current one', () => {
    render(
      <LiveTask
        tasks={[task({ ord: 0, status: 'pending', title: 'Read the scratch file back' })]}
        lastStatus={null}
        lastAgentUpdateAt={null}
      />,
    )
    expect(screen.queryByText('Read the scratch file back')).toBeNull()
  })

  it('shows how far through the plan the run is', () => {
    render(
      <LiveTask
        tasks={[
          task({ ord: 0, status: 'verified' }),
          task({ ord: 1, status: 'running' }),
          task({ ord: 2 }),
        ]}
        lastStatus={null}
        lastAgentUpdateAt={null}
      />,
    )
    expect(screen.getByText('Task 2 of 3')).toBeTruthy()
  })

  it("shows the agent's own last status headline", () => {
    render(
      <LiveTask
        tasks={[task({ ord: 0, status: 'running' })]}
        lastStatus={{ headline: 'Running the failing test', phase: 'verifying', at: 'x' }}
        lastAgentUpdateAt={null}
      />,
    )
    expect(screen.getByText('Running the failing test')).toBeTruthy()
  })

  it('shows elapsed time for the running task', () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString()
    render(
      <LiveTask
        tasks={[task({ ord: 0, status: 'running', startedAt })]}
        lastStatus={null}
        lastAgentUpdateAt={null}
      />,
    )
    expect(screen.getByText(/^1m 0[0-9]s$/)).toBeTruthy()
  })

  it('shows how long ago the agent last produced output', () => {
    render(
      <LiveTask
        tasks={[task({ ord: 0, status: 'running' })]}
        lastStatus={null}
        lastAgentUpdateAt={new Date(Date.now() - 8_000).toISOString()}
      />,
    )
    // The headline can be minutes stale while the agent is mid-tool-call; this
    // is the signal that separates "working" from "wedged".
    expect(screen.getByText(/agent output [0-9]s ago/)).toBeTruthy()
  })

  it('shows no heartbeat when the agent has produced no output', () => {
    render(
      <LiveTask
        tasks={[task({ ord: 0, status: 'running' })]}
        lastStatus={null}
        lastAgentUpdateAt={null}
      />,
    )
    expect(screen.queryByText(/agent output/)).toBeNull()
  })

  it('advances the elapsed time as the run continues', async () => {
    vi.useFakeTimers()
    try {
      const startedAt = new Date(Date.now() - 3_000).toISOString()
      render(
        <LiveTask
          tasks={[task({ ord: 0, status: 'running', startedAt })]}
          lastStatus={null}
          lastAgentUpdateAt={null}
        />,
      )
      expect(screen.getByText('3s')).toBeTruthy()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(screen.getByText('5s')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks the run as working for assistive technology', () => {
    render(
      <LiveTask
        tasks={[task({ ord: 0, status: 'running' })]}
        lastStatus={null}
        lastAgentUpdateAt={null}
      />,
    )
    // A spinner is a purely visual signal; a screen-reader user gets nothing
    // from it. `role="status"` is what makes "something is happening" audible.
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
