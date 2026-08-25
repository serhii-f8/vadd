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

  it('names the remote in both push confirm labels, and each button sends its own', async () => {
    const { calls } = routes({
      'GET /api/projects/p1/git/remotes': {
        body: {
          remotes: [
            { name: 'origin', fetchUrl: 'git@host:me/x.git', pushUrl: 'git@host:me/x.git' },
            { name: 'upstream', fetchUrl: 'git@host:them/x.git', pushUrl: 'git@host:them/x.git' },
          ],
        },
      },
      'POST /api/projects/p1/git/push': { body: { report: { describes: 'Push' } } },
    })
    renderConsole()
    await screen.findByLabelText('Branches')

    const vaddRow = () => {
      const rows = within(screen.getByLabelText('Branches')).getAllByRole('listitem')
      return rows.find((r) => r.textContent?.includes('vadd/fdca5ca3')) as HTMLElement
    }

    const armedLabels: string[] = []
    for (const remote of ['origin', 'upstream']) {
      const button = within(vaddRow()).getByRole('button', {
        name: `Push to ${remote}`,
      }) as HTMLButtonElement
      await userEvent.click(button)
      // Captured while armed: `ConfirmButton` REPLACES its text on the second
      // click's approach, so this string is the whole of what the user reads
      // at the moment the destructive click is one press away.
      armedLabels.push(button.textContent ?? '')
      await userEvent.click(button)
      await waitFor(() =>
        expect(
          calls.some(
            (c) => c.method === 'POST' && (c.body as { remote?: string })?.remote === remote,
          ),
        ).toBe(true),
      )
      await waitFor(() =>
        expect(
          (
            within(vaddRow()).getByRole('button', {
              name: `Push to ${remote}`,
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      )
    }

    // The defect this pins: the VADD-owned arm of the label dropped the
    // remote name, so with two remotes configured BOTH push buttons on a
    // `vadd/<8hex>` row showed identical armed text naming neither.
    expect(armedLabels[0]).toContain('origin')
    expect(armedLabels[0]).not.toContain('upstream')
    expect(armedLabels[1]).toContain('upstream')
    expect(armedLabels[0]).not.toBe(armedLabels[1])
    // And the consequence warning is still on both, not traded away for the
    // remote name.
    for (const label of armedLabels) expect(label).toMatch(/discard/i)
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

describe('GitConsole rewrite-vs-remote warning', () => {
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
    {
      sha: 'e'.repeat(40),
      shortSha: 'eeeeeee',
      subject: 'add the failing test',
      author: 'Serhii',
      date: '2026-08-23T09:00:00.000Z',
      parents: ['f'.repeat(40)],
      refs: [],
    },
  ]

  /** The same topology with the current branch's ahead count varied. */
  function withAhead(ahead: number | null, upstream: string | null = 'origin/master') {
    return {
      ...topology,
      branches: topology.branches.map((b) =>
        b.isCurrent ? { ...b, upstream, ahead, behind: 0 } : b,
      ),
    }
  }

  function rewriteRoutes(ahead: number | null, upstream: string | null = 'origin/master') {
    return routes({
      'GET /api/projects/p1/git': { body: withAhead(ahead, upstream) },
      'GET /api/projects/p1/git/log': { body: { commits, hasMore: false } },
    })
  }

  it('warns before any click when a rewrite would reach a published commit', async () => {
    rewriteRoutes(0)
    renderConsole()

    // Read without arming anything: the dead end this names costs work on a
    // remote, and a warning only visible on the second click is a warning
    // the user meets after deciding.
    const warning = await screen.findByRole('status', { name: /rewrite/i })
    expect(warning.textContent).toMatch(/origin\/master/)
    expect(warning.textContent).toMatch(/force push|fast-forward/i)
  })

  it('says on the destructive click itself that the commit is already published', async () => {
    rewriteRoutes(0)
    renderConsole()
    await userEvent.click(await screen.findByRole('button', { name: 'Drop commit' }))
    expect(screen.getByRole('button', { name: /already on origin\/master/i })).toBeTruthy()
  })

  it('stays quiet when every commit in the range is still unpublished', async () => {
    rewriteRoutes(2)
    renderConsole()
    await screen.findByRole('button', { name: 'Drop commit' })
    expect(screen.queryByRole('status', { name: /rewrite/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Squash last two' }))
    expect(screen.getByRole('button', { name: /^squash the last two/i })).toBeTruthy()
  })

  it('warns per range: with one unpushed commit the squash reaches a published one, the drop does not', async () => {
    rewriteRoutes(1)
    renderConsole()

    await userEvent.click(await screen.findByRole('button', { name: 'Drop commit' }))
    expect(screen.getByRole('button', { name: /^really drop/i }).textContent).not.toMatch(
      /already on/i,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Squash last two' }))
    expect(screen.getByRole('button', { name: /already on origin\/master/i })).toBeTruthy()
  })

  it('stays quiet on a branch with no upstream at all', async () => {
    rewriteRoutes(null, null)
    renderConsole()
    await screen.findByRole('button', { name: 'Drop commit' })
    expect(screen.queryByRole('status', { name: /rewrite/i })).toBeNull()
  })
})
