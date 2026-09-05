import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PlanTask } from '../src/api.js'
import { PlanApproval } from '../src/focus/PlanApproval.js'

function task(over: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 't1',
    ord: 0,
    title: 'Write a failing test',
    description: 'repro',
    status: 'pending',
    expectFailing: null,
    startedAt: null,
    finishedAt: null,
    checkpointRef: null,
    ...over,
  }
}

describe('PlanApproval — A11 expectFailing', () => {
  it('shows a badge for a task that declares expectFailing', () => {
    render(
      <PlanApproval
        tasks={[task({ expectFailing: ['test'] }), task({ id: 't2', title: 'Fix it' })]}
        onCommand={vi.fn()}
      />,
    )
    // The declared ids are the editable field's value — one editor, not a badge beside a copy.
    expect(
      (screen.getByLabelText('Task 1 expected failing commands') as HTMLInputElement).value,
    ).toBe('test')
  })

  it('shows no badge for a task with no expectFailing', () => {
    render(<PlanApproval tasks={[task()]} onCommand={vi.fn()} />)
    expect(
      (screen.getByLabelText('Task 1 expected failing commands') as HTMLInputElement).value,
    ).toBe('')
  })

  it('preserves an agent-declared expectFailing through approve when the human only edits the title', async () => {
    const onCommand = vi.fn()
    const user = userEvent.setup()
    render(<PlanApproval tasks={[task({ expectFailing: ['test'] })]} onCommand={onCommand} />)

    await user.clear(screen.getByLabelText('Task 1 title'))
    await user.type(screen.getByLabelText('Task 1 title'), 'Retitled task')
    await user.click(screen.getByRole('button', { name: /approve plan/i }))

    expect(onCommand).toHaveBeenCalledWith({
      type: 'approve_plan',
      edits: [{ title: 'Retitled task', description: 'repro', expectFailing: ['test'] }],
    })
  })

  it('lets a human add an expectFailing exemption the agent did not propose', async () => {
    const onCommand = vi.fn()
    const user = userEvent.setup()
    render(<PlanApproval tasks={[task()]} onCommand={onCommand} />)

    await user.type(screen.getByLabelText('Task 1 expected failing commands'), 'test')
    await user.click(screen.getByRole('button', { name: /approve plan/i }))

    expect(onCommand).toHaveBeenCalledWith({
      type: 'approve_plan',
      edits: [{ title: 'Write a failing test', description: 'repro', expectFailing: ['test'] }],
    })
  })

  it('lets a human type a second command id via the keyboard, one character at a time', async () => {
    const onCommand = vi.fn()
    const user = userEvent.setup()
    render(<PlanApproval tasks={[task()]} onCommand={onCommand} />)

    await user.type(screen.getByLabelText('Task 1 expected failing commands'), 'test, lint')
    await user.click(screen.getByRole('button', { name: /approve plan/i }))

    expect(onCommand).toHaveBeenCalledWith({
      type: 'approve_plan',
      edits: [
        { title: 'Write a failing test', description: 'repro', expectFailing: ['test', 'lint'] },
      ],
    })
  })

  it('posts revise with a canned instruction when the plan is rejected outright', async () => {
    const onCommand = vi.fn()
    const user = userEvent.setup()
    render(<PlanApproval tasks={[task()]} onCommand={onCommand} />)

    await user.click(screen.getByRole('button', { name: /ask for a different plan/i }))

    expect(onCommand).toHaveBeenCalledWith({
      type: 'revise',
      instruction: 'The plan is wrong — propose a different approach.',
    })
  })

  it('counts pending edits in the action bar, and only once something changed', async () => {
    const user = userEvent.setup()
    render(
      <PlanApproval
        tasks={[
          task({ id: 't1', ord: 0, title: 'Write the failing test' }),
          task({ id: 't2', ord: 1, title: 'Fix it' }),
        ]}
        onCommand={() => undefined}
      />,
    )
    expect(screen.queryByText(/edits? pending/)).toBeNull()
    await user.type(screen.getByLabelText('Task 1 title'), '!')
    expect(screen.getByText(/1 edit pending/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Remove task 2' }))
    expect(screen.getByText(/2 edits pending/)).toBeTruthy()
  })
})
