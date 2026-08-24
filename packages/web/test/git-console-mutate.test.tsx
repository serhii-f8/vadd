import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProjectsProvider } from '../src/app/ProjectsContext.js'
import { UndoBanner } from '../src/git/UndoBanner.js'
import { GitConsole } from '../src/routes/GitConsole.js'
import { mockFetch, type Route } from './setup.js'

const projects = [{ id: 'p1', name: 'vadd', repoPath: '/var/www/vadd', agentKind: 'claude-code' }]

const VADD_OWNER = {
  kind: 'vadd',
  objectiveId: 'o1',
  objectiveTitle: 'Prove worktree write access',
  objectiveStatus: 'executing',
}

const topology = {
  mainRepoPath: '/var/www/vadd',
  currentBranch: 'master',
  branches: [
    {
      name: 'master',
      sha: 'a'.repeat(40),
      isCurrent: true,
      upstream: null,
      owner: { kind: 'user' },
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
    {
      path: '/home/u/.vadd/worktrees/p1/o1',
      branch: 'vadd/fdca5ca3',
      isMain: false,
      prunable: false,
      owner: VADD_OWNER,
    },
  ],
}

const commits = [
  {
    sha: 'd'.repeat(40),
    shortSha: 'ddddddd',
    subject: 'fix the login redirect',
    author: 'Serhii',
    date: '2026-08-23T10:00:00.000Z',
    parents: ['e'.repeat(40)],
    refs: [],
  },
]

function routes(over: Record<string, Route | (() => Route)> = {}) {
  return mockFetch({
    'GET /api/projects': { body: projects },
    'GET /api/projects/p1/git': { body: topology },
    'GET /api/projects/p1/git/log': { body: { commits, hasMore: false } },
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

describe('GitConsole mutation controls', () => {
  it('offers checkout on a user-owned worktree and not on a VADD-owned one', async () => {
    routes()
    renderConsole()

    const list = await screen.findByLabelText('Worktrees')
    const rows = within(list).getAllByRole('listitem')
    const userRow = rows.find((r) => r.textContent?.includes('/var/www/vadd')) as HTMLElement
    const vaddRow = rows.find((r) => r.textContent?.includes('/o1')) as HTMLElement

    // /diff, rollback and integrate: discard all depend on
    // objectives.branchName, and discard deletes the branch it is handed.
    expect(within(userRow).getByRole('button', { name: /switch branch/i })).toBeTruthy()
    expect(within(vaddRow).queryByRole('button', { name: /switch branch/i })).toBeNull()
  })

  it('requires two clicks on a destructive control before the request fires', async () => {
    const mock = routes({
      'POST /api/projects/p1/git/drop': { body: { report: { describes: 'Drop the last commit' } } },
    })
    renderConsole()

    const drop = await screen.findByRole('button', { name: 'Drop commit' })
    await userEvent.click(drop)
    expect(mock.calls.some((c) => c.url.includes('/git/drop'))).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: /really drop/i }))
    await waitFor(() => {
      expect(mock.calls.some((c) => c.url.includes('/git/drop'))).toBe(true)
    })
  })

  it('renders a 409 in place, naming the state, with a Pause beside it', async () => {
    routes({
      'POST /api/projects/p1/git/drop': {
        status: 409,
        body: {
          error: 'Cannot modify git while executing: the agent is editing files',
          objectiveId: 'o1',
        },
      },
    })
    renderConsole()

    await userEvent.click(await screen.findByRole('button', { name: 'Drop commit' }))
    await userEvent.click(screen.getByRole('button', { name: /really drop/i }))

    // In place, not a toast that vanishes — and naming the state, because
    // "it failed" does not tell the user what to do next.
    expect(await screen.findByText(/Cannot modify git while executing/)).toBeTruthy()
    // The whole reason the gate refuses rather than auto-pausing: a pause
    // mid-executing discards an in-flight turn, and that is the user's call.
    expect(screen.getByRole('button', { name: /pause/i })).toBeTruthy()
  })

  it('names every task that lost its rollback point', async () => {
    routes({
      'POST /api/projects/p1/git/drop': {
        body: {
          report: {
            describes: 'Drop the last commit',
            excludedPaths: [],
            clearedCheckpoints: [{ taskId: 't2', ord: 2, title: 'Add the failing test' }],
          },
        },
      },
    })
    renderConsole()

    await userEvent.click(await screen.findByRole('button', { name: 'Drop commit' }))
    await userEvent.click(screen.getByRole('button', { name: /really drop/i }))

    // A nulled checkpoint the user discovers at ROLLBACK is the silent lie
    // the repair exists to prevent, so it is said at the moment it happens.
    expect(await screen.findByText(/Add the failing test/)).toBeTruthy()
    expect(screen.getByText(/rollback point/i)).toBeTruthy()
  })
})

describe('UndoBanner', () => {
  it('renders what it would restore', () => {
    render(<UndoBanner describes="Squash 3 commits" onUndo={() => {}} />)
    expect(screen.getByText('Squash 3 commits')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('renders nothing when there is no record', () => {
    const { container } = render(<UndoBanner describes={null} onUndo={() => {}} />)
    expect(container.textContent).toBe('')
  })
})
