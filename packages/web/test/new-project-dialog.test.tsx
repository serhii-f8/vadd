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

  it('fills the path field from the folder browser', async () => {
    mockFetch({
      ...routes({ status: 201, body: created }),
      'GET /api/fs/browse': {
        body: {
          path: '/home/serhii',
          parent: '/home',
          entries: [{ name: 'flexpick.net', path: '/home/serhii/flexpick.net', isGitRepo: true }],
        },
      },
      'GET /api/fs/browse?path=%2Fhome%2Fserhii%2Fflexpick.net': {
        body: { path: '/home/serhii/flexpick.net', parent: '/home/serhii', entries: [] },
      },
    })
    await renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await userEvent.click(await screen.findByText('flexpick.net'))
    await userEvent.click(screen.getByRole('button', { name: 'Select this folder' }))
    expect((screen.getByLabelText('Repository path') as HTMLInputElement).value).toBe(
      '/home/serhii/flexpick.net',
    )
  })

  it('resets on reopen: no stale error, no stale path', async () => {
    mockFetch(routes({ status: 400, body: { error: 'Not a git repository: /tmp/nope' } }))
    const { rerender } = render(
      <MemoryRouter>
        <ProjectsProvider>
          <NewProjectDialog open onOpenChange={() => undefined} />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    await screen.findByLabelText('Repository path')
    await userEvent.type(screen.getByLabelText('Repository path'), '/tmp/nope')
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    rerender(
      <MemoryRouter>
        <ProjectsProvider>
          <NewProjectDialog open={false} onOpenChange={() => undefined} />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    rerender(
      <MemoryRouter>
        <ProjectsProvider>
          <NewProjectDialog open onOpenChange={() => undefined} />
        </ProjectsProvider>
      </MemoryRouter>,
    )

    await screen.findByLabelText('Repository path')
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Repository path') as HTMLInputElement).value).toBe('')
  })
})

describe('NewProjectDialog — Clone repository tab', () => {
  const routes = (post: { status: number; body: unknown }) => ({
    'GET /api/projects': { body: [] },
    'POST /api/projects': post,
  })

  it('derives a directory name from the URL and lets the user override it', async () => {
    mockFetch(routes({ status: 201, body: created }))
    await renderDialog()
    await userEvent.click(screen.getByRole('tab', { name: 'Clone repository' }))
    await userEvent.type(
      screen.getByLabelText('Repository URL'),
      'https://github.com/user/my-repo.git',
    )
    expect((screen.getByLabelText('Directory name') as HTMLInputElement).value).toBe('my-repo')

    await userEvent.clear(screen.getByLabelText('Directory name'))
    await userEvent.type(screen.getByLabelText('Directory name'), 'custom-name')
    await userEvent.type(screen.getByLabelText('Repository URL'), '2')
    // Once hand-edited, the name field must stop tracking the URL — the same
    // "don't clobber an edit" discipline this project's continuation feature
    // already had to add (see NewObjectiveDialog's seed-fetch effect).
    expect((screen.getByLabelText('Directory name') as HTMLInputElement).value).toBe('custom-name')
  })

  it('sends url, the joined destPath, and agentKind to POST /api/projects/clone', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: [] },
      'POST /api/projects/clone': { status: 201, body: created },
      'GET /api/fs/browse': {
        body: { path: '/home/serhii', parent: '/home', entries: [] },
      },
    })
    await renderDialog()
    await userEvent.click(screen.getByRole('tab', { name: 'Clone repository' }))
    await userEvent.type(screen.getByLabelText('Repository URL'), 'https://example.com/r.git')
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Select this folder' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clone' }))
    await waitFor(() => expect(postBody(calls)).toBeDefined())
    expect(postBody(calls)).toEqual({
      url: 'https://example.com/r.git',
      destPath: '/home/serhii/r',
      agentKind: 'claude-code',
    })
  })

  it('surfaces a clone failure the same way an open-existing failure is surfaced', async () => {
    mockFetch({
      'GET /api/projects': { body: [] },
      'POST /api/projects/clone': { status: 400, body: { error: 'Invalid clone URL: bad scheme' } },
      'GET /api/fs/browse': { body: { path: '/home/serhii', parent: '/home', entries: [] } },
    })
    await renderDialog()
    await userEvent.click(screen.getByRole('tab', { name: 'Clone repository' }))
    await userEvent.type(screen.getByLabelText('Repository URL'), 'ext::sh -c evil')
    await userEvent.click(screen.getByRole('button', { name: 'Clone' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Invalid clone URL')
  })

  it('the Open existing tab is unaffected: submitting still posts to POST /api/projects', async () => {
    const { calls } = mockFetch(routes({ status: 201, body: created }))
    await renderDialog()
    await userEvent.type(screen.getByLabelText('Repository path'), '/var/www/flexpick')
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await waitFor(() => expect(postBody(calls)).toBeDefined())
    expect(postBody(calls)).toEqual({ repoPath: '/var/www/flexpick', agentKind: 'claude-code' })
  })
})
