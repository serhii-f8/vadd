import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DebugPage } from '../src/routes/DebugPage.js'
import { mockFetch } from './setup.js'

describe('DebugPage project registration', () => {
  it('sends the selected agentKind, defaulting to claude-code', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: [] },
      'POST /api/projects': {
        body: { id: 'p1', name: 'p', repoPath: '/r', agentKind: 'claude-code' },
      },
    })
    render(
      <MemoryRouter>
        <DebugPage />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('/absolute/path/to/repo'), '/r')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    const registerCall = calls.find((c) => c.url === '/api/projects' && c.method === 'POST')
    expect(registerCall?.body).toMatchObject({ agentKind: 'claude-code' })
  })

  it('sends codex when that radio option is selected', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: [] },
      'POST /api/projects': { body: { id: 'p1', name: 'p', repoPath: '/r', agentKind: 'codex' } },
    })
    render(
      <MemoryRouter>
        <DebugPage />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('/absolute/path/to/repo'), '/r')
    await user.click(screen.getByRole('radio', { name: 'Codex' }))
    await user.click(screen.getByRole('button', { name: 'Register' }))

    const registerCall = calls.find((c) => c.url === '/api/projects' && c.method === 'POST')
    expect(registerCall?.body).toMatchObject({ agentKind: 'codex' })
  })

  it('shows each registered project agentKind in the project list', async () => {
    mockFetch({
      'GET /api/projects': {
        body: [{ id: 'p1', name: 'flexpick', repoPath: '/r', agentKind: 'codex' }],
      },
    })
    render(
      <MemoryRouter>
        <DebugPage />
      </MemoryRouter>,
    )

    const match = await screen.findByText(/codex/)
    expect(match).toBeDefined()
  })
})
