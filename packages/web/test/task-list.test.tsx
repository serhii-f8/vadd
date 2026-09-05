import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PlanTask } from '../src/api.js'
import { TaskList } from '../src/focus/TaskList.js'

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

const PLAN = [
  task({ ord: 0, title: 'Create a scratch file', status: 'verified' }),
  task({ ord: 1, title: 'Read the scratch file back', status: 'running' }),
  task({ ord: 2, title: 'Edit the scratch file in place' }),
]

describe('TaskList', () => {
  /**
   * The strip this replaces was three 8px dots whose only affordance was a
   * hover tooltip reading "<title> — <status>". That is where the string a
   * user could not place came from, and there was no other way to read it.
   */
  it('shows every task title without needing a hover', () => {
    render(<TaskList tasks={PLAN} />)
    expect(screen.getByText('Create a scratch file')).toBeTruthy()
    expect(screen.getByText('Read the scratch file back')).toBeTruthy()
    expect(screen.getByText('Edit the scratch file in place')).toBeTruthy()
  })

  it('shows each task status alongside its title', () => {
    render(<TaskList tasks={PLAN} />)
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[1] as HTMLElement).getByText('running')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText('verified')).toBeTruthy()
  })

  it('marks the running task as the current step for assistive technology', () => {
    render(<TaskList tasks={PLAN} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[1]?.getAttribute('aria-current')).toBe('step')
    expect(rows[0]?.getAttribute('aria-current')).toBeNull()
  })

  it('marks no task current when none is running', () => {
    render(<TaskList tasks={[task({ ord: 0 }), task({ ord: 1 })]} />)
    for (const row of screen.getAllByRole('listitem')) {
      expect(row.getAttribute('aria-current')).toBeNull()
    }
  })

  it('numbers the tasks in plan order', () => {
    render(<TaskList tasks={PLAN} />)
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[2] as HTMLElement).getByText('3')).toBeTruthy()
  })

  it('shows how long a verified task took', () => {
    render(
      <TaskList
        tasks={[
          task({
            ord: 0,
            status: 'verified',
            startedAt: '2026-09-05T10:00:00.000Z',
            finishedAt: '2026-09-05T10:01:42.000Z',
          }),
          task({ ord: 1, status: 'running', startedAt: '2026-09-05T10:02:00.000Z' }),
        ]}
      />,
    )
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0] as HTMLElement).getByText('1m 42s')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).queryByText(/\dm \d\ds/)).toBeNull()
  })
})
