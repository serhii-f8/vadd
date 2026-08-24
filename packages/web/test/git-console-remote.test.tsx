import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProjectsProvider } from '../src/app/ProjectsContext.js'
import { GitConsole } from '../src/routes/GitConsole.js'
import { mockFetch, type Route } from './setup.js'

const projects = [{ id: 'p1', name: 'vadd', repoPath: '/var/www/vadd', agentKind: 'claude-code' }]

const topology = {
  mainRepoPath: '/var/www/vadd',
  currentBranch: 'master',
  branches: [
    {
      name: 'master',
      sha: 'a'.repeat(40),
      isCurrent: true,
      upstream: 'origin/master',
      ahead: 2,
      behind: 1,
      owner: { kind: 'user' },
    },
    {
      name: 'vadd/fdca5ca3',
      sha: 'b'.repeat(40),
      isCurrent: false,
      upstream: null,
      ahead: null,
      behind: null,
      owner: {
        kind: 'vadd',
        objectiveId: 'o1',
        objectiveTitle: 'Fix the login redirect',
        objectiveStatus: 'awaitingReview',
      },
    },
  ],
  worktrees: [
    {
      path: '/var/www/vadd',
      branch: 'master',
      isMain: true,
      prunable: false,
      owner: { kind: 'user' },
    },
  ],
}

function routes(over: Record<string, Route | (() => Route)> = {}) {
  return mockFetch({
    'GET /api/projects': { body: projects },
    'GET /api/projects/p1/git': { body: topology },
    'GET /api/projects/p1/git/log': { body: { commits: [], hasMore: false } },
    'GET /api/projects/p1/git/remotes': {
      body: {
        remotes: [{ name: 'origin', fetchUrl: 'git@host:me/x.git', pushUrl: 'git@host:me/x.git' }],
      },
    },
    ...over,
  })
}

function renderConsole() {
  return render(
    <MemoryRouter initialEntries={['/git?project=p1']}>
      <ProjectsProvider>
        <GitConsole />
      </ProjectsProvider>
    </MemoryRouter>,
  )
}

describe('GitConsole remotes', () => {
  it('lists the configured remotes with their urls', async () => {
    routes()
    renderConsole()
    expect(await screen.findByText('origin')).toBeTruthy()
    expect(screen.getByText('git@host:me/x.git')).toBeTruthy()
  })

  it('shows ahead/behind for a tracked branch and nothing for an untracked one', async () => {
    routes()
    renderConsole()
    const list = await screen.findByLabelText('Branches')
    const rows = within(list).getAllByRole('listitem')
    const tracked = rows.find((r) => r.textContent?.includes('master')) as HTMLElement
    const untracked = rows.find((r) => r.textContent?.includes('vadd/fdca5ca3')) as HTMLElement
    expect(within(tracked).getByText(/2 ahead/)).toBeTruthy()
    expect(within(tracked).getByText(/1 behind/)).toBeTruthy()
    expect(within(untracked).queryByText(/ahead/)).toBeNull()
  })

  it('warns that a pushed objective branch outlives integrate: discard', async () => {
    routes()
    renderConsole()
    const list = await screen.findByLabelText('Branches')
    const rows = within(list).getAllByRole('listitem')
    const vaddRow = rows.find((r) => r.textContent?.includes('vadd/fdca5ca3')) as HTMLElement
    await userEvent.click(within(vaddRow).getByRole('button', { name: /^push/i }))
    // The consequence is named while the user can still decline, exactly as
    // the cleared-checkpoint warning is. VADD will not delete from a remote,
    // so this leak is stated rather than fixed.
    expect(within(vaddRow).getByRole('button', { name: /discard/i })).toBeTruthy()
  })

  it('renders a remote refusal in place', async () => {
    routes({
      'POST /api/projects/p1/git/fetch': {
        status: 502,
        body: { error: 'fatal: could not read from remote repository' },
      },
    })
    renderConsole()
    await userEvent.click(await screen.findByRole('button', { name: /^fetch/i }))
    await userEvent.click(screen.getByRole('button', { name: /fetch origin/i }))
    expect(await screen.findByText(/could not read from remote repository/)).toBeTruthy()
  })

  it('offers no undo after a push', async () => {
    routes({
      'POST /api/projects/p1/git/push': {
        body: { report: { describes: 'Push master to origin' } },
      },
    })
    renderConsole()
    const list = await screen.findByLabelText('Branches')
    const rows = within(list).getAllByRole('listitem')
    const row = rows.find((r) => r.textContent?.includes('master')) as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: /^push/i }))
    await userEvent.click(within(row).getByRole('button', { name: /push master/i }))
    await waitFor(() => expect(screen.getByText('Push master to origin')).toBeTruthy())
    // The UI consequence of MutationKind.undoable: an Undo here would reset
    // the local branch and un-push nothing.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})
