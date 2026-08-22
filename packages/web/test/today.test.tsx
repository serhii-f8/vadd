import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

  // Selection now happens by navigating to a different `?project=`, owned by
  // the shell rather than this page — so the "switch" is modeled as a fresh
  // render at a different `initialEntries`, not an in-page interaction.
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

    const first = renderToday('/today')
    expect(await screen.findByText('1')).toBeTruthy()
    first.unmount()

    renderToday('/today?project=p2')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'))
    expect(screen.queryByText(/tasks verified/i)).toBeNull()
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
