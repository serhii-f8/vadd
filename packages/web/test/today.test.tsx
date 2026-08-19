import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Today } from '../src/routes/Today.js'
import { mockFetch } from './setup.js'

function renderToday(initialEntry = '/today') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/today" element={<Today />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Today', () => {
  it('renders the three counts from the fetched summary', async () => {
    mockFetch({
      'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
      'GET /api/projects/p1/today': {
        body: { date: '2026-08-19', verifiedTasks: 2, decisionsMade: 1, checksPassed: 3 },
      },
    })
    renderToday()
    expect(await screen.findByText('2 tasks verified')).toBeTruthy()
    expect(screen.getByText('1 decision made')).toBeTruthy()
    expect(screen.getByText('3 checks passed')).toBeTruthy()
  })

  it('uses singular wording for a count of exactly one', async () => {
    mockFetch({
      'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
      'GET /api/projects/p1/today': {
        body: { date: '2026-08-19', verifiedTasks: 1, decisionsMade: 1, checksPassed: 1 },
      },
    })
    renderToday()
    expect(await screen.findByText('1 task verified')).toBeTruthy()
    expect(screen.getByText('1 check passed')).toBeTruthy()
  })

  it('hides the project dropdown with only one project registered', async () => {
    mockFetch({
      'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
      'GET /api/projects/p1/today': {
        body: { date: '2026-08-19', verifiedTasks: 0, decisionsMade: 0, checksPassed: 0 },
      },
    })
    renderToday()
    await screen.findByText('0 tasks verified')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows a dropdown and switches project on selection', async () => {
    mockFetch({
      'GET /api/projects': {
        body: [
          { id: 'p1', name: 'Flexpick', repoPath: '/r1' },
          { id: 'p2', name: 'Wheelership', repoPath: '/r2' },
        ],
      },
      'GET /api/projects/p1/today': {
        body: { date: '2026-08-19', verifiedTasks: 1, decisionsMade: 0, checksPassed: 0 },
      },
      'GET /api/projects/p2/today': {
        body: { date: '2026-08-19', verifiedTasks: 9, decisionsMade: 0, checksPassed: 0 },
      },
    })
    renderToday()
    await screen.findByText('1 task verified')

    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox'), 'p2')

    expect(await screen.findByText('9 tasks verified')).toBeTruthy()
  })

  it('defaults to the first project when ?project= is absent, and honors it when present', async () => {
    mockFetch({
      'GET /api/projects': {
        body: [
          { id: 'p1', name: 'Flexpick', repoPath: '/r1' },
          { id: 'p2', name: 'Wheelership', repoPath: '/r2' },
        ],
      },
      'GET /api/projects/p1/today': {
        body: { date: '2026-08-19', verifiedTasks: 1, decisionsMade: 0, checksPassed: 0 },
      },
      'GET /api/projects/p2/today': {
        body: { date: '2026-08-19', verifiedTasks: 9, decisionsMade: 0, checksPassed: 0 },
      },
    })
    renderToday('/today?project=p2')
    expect(await screen.findByText('9 tasks verified')).toBeTruthy()
  })

  it('shows the server error rather than a blank page', async () => {
    mockFetch({
      'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
      'GET /api/projects/p1/today': { status: 500, body: { error: 'boom' } },
    })
    renderToday()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'))
  })
})
