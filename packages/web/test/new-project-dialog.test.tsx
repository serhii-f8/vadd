import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProjectsProvider } from '../src/app/ProjectsContext.js'
import { NewProjectDialog } from '../src/projects/NewProjectDialog.js'
import { mockFetch } from './setup.js'

const created = {
  id: 'p9',
  name: 'flexpick.net',
  repoPath: '/var/www/flexpick',
  config: {},
  agentKind: 'claude-code',
  createdAt: '2026-08-22T00:00:00.000Z',
}

/**
 * The provider is required, not decorative: the dialog calls `useProjects()`
 * for `addProject`/`select`, which throws outside it. That also means a
 * `GET /api/projects` precedes every POST, so assertions find the POST rather
 * than indexing `calls[0]`.
 */
async function renderDialog() {
  render(
    <MemoryRouter>
      <ProjectsProvider>
        <NewProjectDialog open onOpenChange={() => undefined} />
      </ProjectsProvider>
    </MemoryRouter>,
  )
  await screen.findByLabelText('Repository path')
}

const postBody = (calls: Array<{ method: string; body: unknown }>) =>
  calls.find((c) => c.method === 'POST')?.body

describe('NewProjectDialog', () => {
  const routes = (post: { status: number; body: unknown }) => ({
    'GET /api/projects': { body: [] },
    'POST /api/projects': post,
  })

  it('posts the repo path and the default agent', async () => {
    const { calls } = mockFetch(routes({ status: 201, body: created }))
    await renderDialog()
    await userEvent.type(screen.getByLabelText('Repository path'), '/var/www/flexpick')
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await waitFor(() => expect(postBody(calls)).toBeDefined())
    expect(postBody(calls)).toEqual({ repoPath: '/var/www/flexpick', agentKind: 'claude-code' })
  })

  it('sends codex when chosen', async () => {
    const { calls } = mockFetch(routes({ status: 201, body: created }))
    await renderDialog()
    await userEvent.type(screen.getByLabelText('Repository path'), '/var/www/flexpick')
    await userEvent.click(screen.getByRole('radio', { name: /Codex/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await waitFor(() => expect(postBody(calls)).toBeDefined())
    expect((postBody(calls) as { agentKind: string }).agentKind).toBe('codex')
  })

  it('sends an optional name when given', async () => {
    const { calls } = mockFetch(routes({ status: 201, body: created }))
    await renderDialog()
    await userEvent.type(screen.getByLabelText('Repository path'), '/var/www/flexpick')
    await userEvent.type(screen.getByLabelText(/Name/), 'flexpick')
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await waitFor(() => expect(postBody(calls)).toBeDefined())
    expect((postBody(calls) as { name?: string }).name).toBe('flexpick')
  })

  it('surfaces the server message when the path is not a git repository', async () => {
    mockFetch(routes({ status: 400, body: { error: 'Not a git repository: /tmp/nope' } }))
    await renderDialog()
    await userEvent.type(screen.getByLabelText('Repository path'), '/tmp/nope')
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Not a git repository')
  })

  it('surfaces a duplicate registration rather than dead-ending', async () => {
    mockFetch(routes({ status: 409, body: { error: 'Repository is already registered' } }))
    await renderDialog()
    await userEvent.type(screen.getByLabelText('Repository path'), '/var/www/flexpick')
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('already registered')
  })

  it('does not submit an empty path', async () => {
    const { calls } = mockFetch(routes({ status: 201, body: created }))
    await renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
    expect(postBody(calls)).toBeUndefined()
  })
})
