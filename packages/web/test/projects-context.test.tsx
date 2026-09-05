import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  PROJECT_STORAGE_KEY,
  ProjectsProvider,
  useDerivedProject,
  useProjects,
} from '../src/app/ProjectsContext.js'
import { mockFetch } from './setup.js'

const projects = [
  { id: 'p1', name: 'flexpick.net', repoPath: '/a', agentKind: 'claude-code' },
  { id: 'p2', name: 'vadd', repoPath: '/b', agentKind: 'codex' },
]

function Probe() {
  const { selected, select } = useProjects()
  return (
    <>
      <span data-testid="selected">{selected?.name ?? 'none'}</span>
      <button type="button" onClick={() => select('p2')}>
        switch
      </button>
    </>
  )
}

/** A screen that belongs to one project — the Focus View's shape. */
function Derived({ id }: { id: string }) {
  useDerivedProject(id)
  return <Probe />
}

function at(path: string, routes = <Route path="*" element={<Probe />} />) {
  mockFetch({ 'GET /api/projects': { body: projects } })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProjectsProvider>
        <Routes>{routes}</Routes>
      </ProjectsProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())

/**
 * The bug this order exists for: viewing a flexpick.net objective showed
 * `vadd-demo-repo` in the sidebar, and Back went there — the URL had no
 * `?project=`, so the context fell through to the first registered project.
 */
describe('project resolution order', () => {
  it('a derived project beats the URL', async () => {
    at('/o/x?project=p1', <Route path="/o/:id" element={<Derived id="p2" />} />)
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('vadd'))
  })

  it('the URL beats the stored project', async () => {
    localStorage.setItem(PROJECT_STORAGE_KEY, 'p2')
    at('/?project=p1')
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('flexpick.net'))
  })

  it('the stored project beats the first one', async () => {
    localStorage.setItem(PROJECT_STORAGE_KEY, 'p2')
    at('/')
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('vadd'))
  })

  it('an unknown stored id degrades to the first project', async () => {
    localStorage.setItem(PROJECT_STORAGE_KEY, 'gone')
    at('/')
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('flexpick.net'))
  })

  it('select() remembers the choice', async () => {
    at('/')
    await screen.findByTestId('selected')
    await userEvent.click(screen.getByRole('button', { name: 'switch' }))
    await waitFor(() => expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe('p2'))
  })

  it('a derived project is remembered, and stops applying once its screen unmounts', async () => {
    const view = at('/o/x', <Route path="/o/:id" element={<Derived id="p2" />} />)
    await waitFor(() => expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe('p2'))
    view.unmount()

    // A fresh mount with nothing stored must not still carry p2 from the
    // unmounted screen — only the storage write above may outlive it.
    localStorage.clear()
    at('/')
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('flexpick.net'))
  })
})
