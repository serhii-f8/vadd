import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ObjectiveListRow } from '../src/api.js'
import { WorkingNow } from '../src/app/WorkingNow.js'

const row = (over: Partial<ObjectiveListRow>): ObjectiveListRow => ({
  id: 'o',
  projectId: 'p1',
  title: 't',
  goalText: 'g',
  status: 'idle',
  worktreePath: null,
  branchName: null,
  baseSha: null,
  integrateAction: null,
  continuedFromId: null,
  lowEnergy: false,
  mode: 'standard',
  updatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  verifiedCount: 0,
  totalCount: 0,
  ...over,
})

function renderIt(objectives: ObjectiveListRow[] | null) {
  return render(
    <MemoryRouter>
      <WorkingNow objectives={objectives} />
    </MemoryRouter>,
  )
}

describe('WorkingNow', () => {
  it('lists only the objectives the agent is working on, as links', () => {
    renderIt([
      row({ id: 'a', title: 'Score History', status: 'executing' }),
      row({ id: 'b', title: 'Needs a decision', status: 'awaitingDecision' }),
      row({ id: 'c', title: 'Finished', status: 'done' }),
    ])
    const link = screen.getByRole('link', { name: /Score History/ })
    expect(link.getAttribute('href')).toBe('/o/a')
    expect(link.textContent).toContain('Executing')
    expect(link.textContent).toContain('3 min ago')
    expect(screen.queryByText('Needs a decision')).toBeNull()
    expect(screen.queryByText('Finished')).toBeNull()
  })

  it('says nothing is running, and how many need you', () => {
    renderIt([row({ id: 'b', status: 'awaitingReview' }), row({ id: 'c', status: 'done' })])
    expect(screen.getByText(/Nothing running/)).toBeTruthy()
    expect(screen.getByText(/1 needs you/)).toBeTruthy()
  })

  it('renders nothing at all while the list is still loading', () => {
    const { container } = renderIt(null)
    expect(container.textContent).toBe('')
  })
})
