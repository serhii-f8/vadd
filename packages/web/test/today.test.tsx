import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProjectsProvider } from '../src/app/ProjectsContext.js'
import { Today } from '../src/routes/Today.js'
import { mockFetch } from './setup.js'

function renderToday(initialEntry = '/today') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ProjectsProvider>
        <Routes>
          <Route path="/today" element={<Today />} />
        </Routes>
      </ProjectsProvider>
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
    expect(await screen.findByText('2')).toBeTruthy()
    expect(screen.getByText(/tasks verified/i)).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText(/decisions made/i)).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText(/checks passed/i)).toBeTruthy()
  })

  it('uses the same label regardless of a count of exactly one', async () => {
    mockFetch({
      'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
      'GET /api/projects/p1/today': {
        body: { date: '2026-08-19', verifiedTasks: 1, decisionsMade: 1, checksPassed: 1 },
      },
    })
    renderToday()
    expect(await screen.findAllByText('1')).toHaveLength(3)
    expect(screen.getByText(/tasks verified/i)).toBeTruthy()
    expect(screen.getByText(/checks passed/i)).toBeTruthy()
  })

  // The project switcher itself moved to AppShell's Sidebar (see
  // app-shell.test.tsx) once ProjectsContext became the single selection
  // path; Today never renders one of its own now, regardless of how many
  // projects are registered.
  it('renders no project switcher of its own', async () => {
    mockFetch({
      'GET /api/projects': {
        body: [
          { id: 'p1', name: 'Flexpick', repoPath: '/r1' },
          { id: 'p2', name: 'Wheelership', repoPath: '/r2' },
        ],
      },
      'GET /api/projects/p1/today': {
        body: { date: '2026-08-19', verifiedTasks: 0, decisionsMade: 0, checksPassed: 0 },
      },
    })
    renderToday()
    await screen.findByText(/tasks verified/i)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  // Same intent as the pre-redesign version of this test ("shows a dropdown
  // and switches project on selection"), but the selection control is no
  // longer part of Today — it's driven through ProjectsContext / the URL,
  // exercised here directly via `?project=`.
  it('honors ?project= in the URL', async () => {
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
    expect(await screen.findByText('9')).toBeTruthy()
  })

  it('defaults to the first project when ?project= is absent', async () => {
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
    expect(await screen.findByText('1')).toBeTruthy()
  })

  it('shows the server error rather than a blank page', async () => {
    mockFetch({
      'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
      'GET /api/projects/p1/today': { status: 500, body: { error: 'boom' } },
    })
    renderToday()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'))
  })

  // The stale-data guard this pins is only meaningful against an
  // ALREADY-MOUNTED Today whose selectedId changes under it — two separate
  // render()/unmount() calls would start the second instance at
  // summary=null/error=null from useState alone, making the assertion pass
  // even if Today.tsx's own setSummary(null)/setError(null) reset lines
  // were deleted. `Switcher` drives the same selection change ObjectiveList's
  // "narrows the board" test uses, so the same mounted Today instance lives
  // through the switch.
  it("clears the previous project's counts and shows an error when the newly selected project's fetch fails", async () => {
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
      'GET /api/projects/p2/today': { status: 500, body: { error: 'boom' } },
    })

    /**
     * Navigates rather than calling `select()`: selecting a project now lands
     * on the objective list, which would unmount this page before it could
     * clear anything. The regression this guards — a failed fetch for a newly
     * selected project leaving the *previous* project's counts on screen under
     * the new project's name — is still reachable, because `?project=` can
     * change under this page by any route change that keeps it mounted.
     */
    function Switcher() {
      const navigate = useNavigate()
      return (
        <button type="button" onClick={() => navigate('/today?project=p2')}>
          switch project
        </button>
      )
    }

    render(
      <MemoryRouter initialEntries={['/today']}>
        <ProjectsProvider>
          <Switcher />
          <Routes>
            <Route path="/today" element={<Today />} />
          </Routes>
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('1')).toBeTruthy()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'switch project' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'))
    expect(screen.queryByText(/tasks verified/i)).toBeNull()
    expect(screen.queryByText('1')).toBeNull()
  })

  it('renders counts as cards, still text only', async () => {
    mockFetch({
      'GET /api/projects': {
        body: [
          {
            id: 'p1',
            name: 'flexpick.net',
            repoPath: '/r',
            config: {},
            agentKind: 'claude-code',
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      },
      'GET /api/projects/p1/today': {
        body: { date: '2026-08-22', verifiedTasks: 3, decisionsMade: 1, checksPassed: 7 },
      },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <Today />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('3')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText(/tasks verified/i)).toBeTruthy()
  })
})
