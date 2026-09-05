import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ProjectsProvider, useProjects } from '../src/app/ProjectsContext.js'
import { mockFetch } from './setup.js'

const projects = [
  { id: 'p1', name: 'flexpick.net', repoPath: '/var/www/flexpick', agentKind: 'claude-code' },
  { id: 'p2', name: 'vadd', repoPath: '/var/www/vadd', agentKind: 'codex' },
]

/** Renders the current location so the test can assert where a switch lands. */
function Probe() {
  const { select, selected } = useProjects()
  const location = useLocation()
  return (
    <>
      <span data-testid="where">{`${location.pathname}${location.search}`}</span>
      <span data-testid="selected">{selected?.name ?? 'none'}</span>
      <button type="button" onClick={() => select('p2')}>
        switch
      </button>
    </>
  )
}

function renderAt(initial: string) {
  mockFetch({ 'GET /api/projects': { body: projects } })
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ProjectsProvider>
        <Routes>
          <Route path="/" element={<Probe />} />
          <Route path="/objectives/:id" element={<Probe />} />
          <Route path="/today" element={<Probe />} />
        </Routes>
      </ProjectsProvider>
    </MemoryRouter>,
  )
}

describe('switching projects', () => {
  // `select()` now remembers the choice in localStorage, and jsdom shares it
  // across the tests in one file: a clean slate is what each test assumes.
  beforeEach(() => localStorage.clear())

  /**
   * The Focus View is scoped to one objective, and an objective belongs to one
   * project. Switching the project while looking at one left the user on a
   * detail screen belonging to the project they just navigated away from —
   * the switcher appeared to do nothing at all.
   */
  it('returns to the objective list when switching from an objective screen', async () => {
    renderAt('/objectives/o1')
    await screen.findByTestId('where')

    await userEvent.click(screen.getByRole('button', { name: 'switch' }))

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/?project=p2'))
  })

  it('returns to the objective list when switching from any other page', async () => {
    renderAt('/today')
    await screen.findByTestId('where')

    await userEvent.click(screen.getByRole('button', { name: 'switch' }))

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/?project=p2'))
  })

  it('actually selects the project it navigated for', async () => {
    renderAt('/objectives/o1')
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('flexpick.net'))

    await userEvent.click(screen.getByRole('button', { name: 'switch' }))

    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('vadd'))
  })
})
