import { render, screen, waitFor } from '@testing-library/react'
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
})
