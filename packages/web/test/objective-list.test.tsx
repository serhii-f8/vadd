import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProjectsProvider, useProjects } from '../src/app/ProjectsContext.js'
import { ObjectiveList } from '../src/routes/ObjectiveList.js'
import { mockFetch } from './setup.js'

/** The board is always scoped to a project; the live hook fetches nothing without one. */
const project = {
  id: 'p1',
  name: 'flexpick.net',
  repoPath: '/var/www/flexpick',
  agentKind: 'claude-code',
}

const objective = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  projectId: 'p1',
  title: 'Fix the login redirect',
  status: 'executing',
  worktreePath: '/tmp/wt',
  branchName: 'vadd/abc12345',
  integrateAction: null,
  mode: 'standard',
  updatedAt: '2026-09-05T09:57:00.000Z',
  verifiedCount: 1,
  totalCount: 3,
  ...over,
})

describe('ObjectiveList', () => {
  it('lists objectives with their state', async () => {
    mockFetch({
      'GET /api/projects': { body: [project] },
      'GET /api/objectives': { body: [objective()] },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Fix the login redirect')).toBeTruthy()
    // Human words, not the machine name (spec §3.2).
    expect(screen.getByText('Executing')).toBeTruthy()
  })

  it('links each row to its Focus View', async () => {
    mockFetch({
      'GET /api/projects': { body: [project] },
      'GET /api/objectives': { body: [objective()] },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    const link = await screen.findByRole('link', { name: /Fix the login redirect/ })
    expect(link.getAttribute('href')).toBe('/o/o1')
  })

  it('distinguishes a done objective whose work was discarded', async () => {
    mockFetch({
      'GET /api/projects': { body: [project] },
      'GET /api/objectives': {
        body: [objective({ status: 'done', integrateAction: 'discard' })],
      },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/discard/)).toBeTruthy()
  })

  it('shows the server error rather than an empty list', async () => {
    mockFetch({
      'GET /api/projects': { body: [project] },
      'GET /api/objectives': { status: 500, body: { error: 'boom' } },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'))
  })

  it('says so plainly when there are none', async () => {
    mockFetch({
      'GET /api/projects': { body: [project] },
      'GET /api/objectives': { body: [] },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/No objectives yet/)).toBeTruthy()
  })

  it('shows the verified/total fraction and a state dot', async () => {
    mockFetch({
      'GET /api/projects': { body: [project] },
      'GET /api/objectives': { body: [objective()] },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('1/3')).toBeTruthy()
  })

  // The project switcher itself moved to AppShell's Sidebar (see
  // app-shell.test.tsx) once ProjectsContext became the single selection
  // path; ObjectiveList never renders one of its own now, regardless of how
  // many projects are registered.
  it('renders no project switcher of its own', async () => {
    mockFetch({
      'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
      'GET /api/objectives': { body: [objective()] },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Fix the login redirect')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  // Same intent as the pre-redesign version of this test ("narrows the board
  // on selection"), but the selection control is no longer part of
  // ObjectiveList — it's driven through ProjectsContext, exercised here via
  // a minimal harness that stands in for the shell's real Select.
  it('narrows the board when the selected project changes', async () => {
    mockFetch({
      'GET /api/projects': {
        body: [
          { id: 'p1', name: 'Flexpick', repoPath: '/r1' },
          { id: 'p2', name: 'Wheelership', repoPath: '/r2' },
        ],
      },
      'GET /api/objectives': { body: [objective({ id: 'o1', title: 'in Flexpick' })] },
      'GET /api/objectives?projectId=p2': {
        body: [objective({ id: 'o2', title: 'in Wheelership' })],
      },
    })

    function Switcher() {
      const { select } = useProjects()
      return (
        <button type="button" onClick={() => select('p2')}>
          switch project
        </button>
      )
    }

    render(
      <MemoryRouter>
        <ProjectsProvider>
          <Switcher />
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('in Flexpick')).toBeTruthy()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'switch project' }))

    expect(await screen.findByText('in Wheelership')).toBeTruthy()
    expect(screen.queryByText('in Flexpick')).toBeNull()
  })

  it('honors ?project= in the URL', async () => {
    mockFetch({
      'GET /api/projects': {
        body: [
          { id: 'p1', name: 'Flexpick', repoPath: '/r1' },
          { id: 'p2', name: 'Wheelership', repoPath: '/r2' },
        ],
      },
      'GET /api/objectives': { body: [objective({ id: 'o1', title: 'in Flexpick' })] },
      'GET /api/objectives?projectId=p2': {
        body: [objective({ id: 'o2', title: 'in Wheelership' })],
      },
    })
    render(
      <MemoryRouter initialEntries={['/?project=p2']}>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('in Wheelership')).toBeTruthy()
  })

  it('shows an empty state that offers the next action', async () => {
    mockFetch({ 'GET /api/projects': { body: [project] }, 'GET /api/objectives': { body: [] } })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/No objectives yet/)).toBeTruthy()
  })

  it('labels the status dot rather than relying on color alone', async () => {
    mockFetch({
      'GET /api/projects': { body: [project] },
      'GET /api/objectives': { body: [objective({ status: 'awaitingReview' })] },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <ObjectiveList />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByLabelText('Needs you')).toBeTruthy()
  })

  describe('project memory section', () => {
    it('renders architecture and known-issue notes under labeled headings', async () => {
      mockFetch({
        'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
        'GET /api/objectives?projectId=p1': { body: [] },
        'GET /api/projects/p1/memory': {
          body: {
            notes: [
              {
                id: 'm1',
                kind: 'architecture',
                headline: 'Auth lives in src/auth/',
                content: 'JWT validation in middleware.ts.',
                sourceObjectiveId: 'o1',
                createdAt: '2026-08-27T00:00:00.000Z',
              },
              {
                id: 'm2',
                kind: 'known_issue',
                headline: 'CI is flaky',
                content: 'Parallel runs occasionally time out.',
                sourceObjectiveId: null,
                createdAt: '2026-08-27T00:00:01.000Z',
              },
            ],
          },
        },
      })
      render(
        <MemoryRouter>
          <ProjectsProvider>
            <ObjectiveList />
          </ProjectsProvider>
        </MemoryRouter>,
      )
      expect(await screen.findByText('Known project structure')).toBeTruthy()
      expect(screen.getByText('Auth lives in src/auth/')).toBeTruthy()
      expect(screen.getByText('Known issues')).toBeTruthy()
      expect(screen.getByText('CI is flaky').textContent).toBe('CI is flaky')

      const link = screen.getByRole('link', { name: 'Auth lives in src/auth/' })
      expect(link.getAttribute('href')).toBe('/o/o1')
    })

    it('renders nothing extra when there is no memory yet', async () => {
      mockFetch({
        'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
        'GET /api/objectives?projectId=p1': { body: [] },
        'GET /api/projects/p1/memory': { body: { notes: [] } },
      })
      render(
        <MemoryRouter>
          <ProjectsProvider>
            <ObjectiveList />
          </ProjectsProvider>
        </MemoryRouter>,
      )
      await screen.findByText(/No objectives yet/)
      expect(screen.queryByText('Known project structure')).toBeNull()
      expect(screen.queryByText('Known issues')).toBeNull()
    })
  })
})
