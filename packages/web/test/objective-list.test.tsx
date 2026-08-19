import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ObjectiveList } from '../src/routes/ObjectiveList.js'
import { mockFetch } from './setup.js'

const objective = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  projectId: 'p1',
  title: 'Fix the login redirect',
  status: 'executing',
  worktreePath: '/tmp/wt',
  branchName: 'vadd/abc12345',
  integrateAction: null,
  verifiedCount: 1,
  totalCount: 3,
  ...over,
})

describe('ObjectiveList', () => {
  it('lists objectives with their state', async () => {
    mockFetch({ 'GET /api/objectives': { body: [objective()] } })
    render(
      <MemoryRouter>
        <ObjectiveList />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Fix the login redirect')).toBeTruthy()
    expect(screen.getByText('executing')).toBeTruthy()
  })

  it('links each row to its Focus View', async () => {
    mockFetch({ 'GET /api/objectives': { body: [objective()] } })
    render(
      <MemoryRouter>
        <ObjectiveList />
      </MemoryRouter>,
    )
    const link = await screen.findByRole('link', { name: /Fix the login redirect/ })
    expect(link.getAttribute('href')).toBe('/o/o1')
  })

  it('distinguishes a done objective whose work was discarded', async () => {
    mockFetch({
      'GET /api/objectives': {
        body: [objective({ status: 'done', integrateAction: 'discard' })],
      },
    })
    render(
      <MemoryRouter>
        <ObjectiveList />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/discard/)).toBeTruthy()
  })

  it('shows the server error rather than an empty list', async () => {
    mockFetch({ 'GET /api/objectives': { status: 500, body: { error: 'boom' } } })
    render(
      <MemoryRouter>
        <ObjectiveList />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'))
  })

  it('says so plainly when there are none', async () => {
    mockFetch({ 'GET /api/objectives': { body: [] } })
    render(
      <MemoryRouter>
        <ObjectiveList />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/No objectives yet/)).toBeTruthy()
  })

  it('shows the verified/total fraction and a state dot', async () => {
    mockFetch({ 'GET /api/objectives': { body: [objective()] } })
    render(
      <MemoryRouter>
        <ObjectiveList />
      </MemoryRouter>,
    )
    expect(await screen.findByText('1/3')).toBeTruthy()
  })

  it('hides the project switcher with only one project registered', async () => {
    mockFetch({
      'GET /api/projects': { body: [{ id: 'p1', name: 'Flexpick', repoPath: '/r' }] },
      'GET /api/objectives': { body: [objective()] },
    })
    render(
      <MemoryRouter>
        <ObjectiveList />
      </MemoryRouter>,
    )
    await screen.findByText('Fix the login redirect')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows a project switcher and narrows the board on selection', async () => {
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
      <MemoryRouter>
        <ObjectiveList />
      </MemoryRouter>,
    )
    expect(await screen.findByText('in Flexpick')).toBeTruthy()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox'), 'p2')

    expect(await screen.findByText('in Wheelership')).toBeTruthy()
    expect(screen.queryByText('in Flexpick')).toBeNull()
  })

  it('defaults to All projects when ?project= is absent, and honors it when present', async () => {
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
        <ObjectiveList />
      </MemoryRouter>,
    )
    expect(await screen.findByText('in Wheelership')).toBeTruthy()
  })
})
