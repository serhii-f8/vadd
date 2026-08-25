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
      upstream: null,
      ahead: null,
      behind: null,
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
  ],
}

const VANISHED = {
  kind: 'vanished',
  path: '/home/u/.vadd/worktrees/p1/o1',
  claim: { objectiveId: 'o1', objectiveTitle: 'Fix the login redirect', objectiveStatus: 'paused' },
  branchName: 'vadd/o1abc123',
}
const STRANDED = { kind: 'stranded', path: '/home/u/.vadd/worktrees/p1/left-behind', claim: null }

function routes(over: Record<string, Route | (() => Route)> = {}) {
  return mockFetch({
    'GET /api/projects': { body: projects },
    'GET /api/projects/p1/git': { body: topology },
    'GET /api/projects/p1/git/log': { body: { commits: [], hasMore: false } },
    'GET /api/projects/p1/git/remotes': { body: { remotes: [] } },
    'GET /api/projects/p1/git/strays': { body: { strays: [VANISHED, STRANDED] } },
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

describe('GitConsole strays', () => {
  it('lists both kinds by path, naming the objective when one claims it', async () => {
    routes()
    renderConsole()
    const list = await screen.findByLabelText('Stray worktrees')
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Fix the login redirect')
    // The unclaimed one has no objective to name and must not imply it has.
    expect(rows[1]?.textContent).toContain('left-behind')
    expect(rows[1]?.textContent).not.toMatch(/Fix the login redirect/)
  })

  it('says only the record is cleared for a vanished stray, and that files are deleted for a stranded one', async () => {
    routes()
    renderConsole()
    const list = await screen.findByLabelText('Stray worktrees')
    const rows = within(list).getAllByRole('listitem')

    await userEvent.click(within(rows[0] as HTMLElement).getByRole('button'))
    expect(within(rows[0] as HTMLElement).getByRole('button').textContent).toMatch(
      /record|nothing on disk/i,
    )

    await userEvent.click(within(rows[1] as HTMLElement).getByRole('button'))
    expect(within(rows[1] as HTMLElement).getByRole('button').textContent).toMatch(/delete/i)
  })

  // With several vanished rows, an armed confirm button reading only "Clear
  // this record?" would be identical on every one — the same shape of finding
  // already recorded once for Pass C's two-remote push buttons. The label
  // must name which record.
  it('names the claiming objective on a vanished stray’s armed confirm label', async () => {
    routes()
    renderConsole()
    const list = await screen.findByLabelText('Stray worktrees')
    const rows = within(list).getAllByRole('listitem')

    await userEvent.click(within(rows[0] as HTMLElement).getByRole('button'))
    expect(within(rows[0] as HTMLElement).getByRole('button').textContent).toContain(
      VANISHED.claim.objectiveTitle,
    )
  })

  it('sends the path and reloads after a release', async () => {
    const mock = routes({
      'POST /api/projects/p1/git/release': { body: { report: { describes: 'Released' } } },
    })
    renderConsole()
    const list = await screen.findByLabelText('Stray worktrees')
    const row = within(list).getAllByRole('listitem')[0] as HTMLElement

    await userEvent.click(within(row).getByRole('button'))
    await userEvent.click(within(row).getByRole('button'))
    await waitFor(() => {
      const call = mock.calls.find((c) => c.url.includes('/git/release'))
      expect(call).toBeTruthy()
      // `mockFetch` already parses the sent body into an object (see
      // `setup.ts`), so `call.body` is the object itself, not a JSON
      // string — matching every other test's `?.body).toEqual(...)`
      // pattern (e.g. `focus-view.test.tsx`), not a re-`JSON.parse`.
      expect(call?.body).toEqual({ path: VANISHED.path })
    })
  })

  it('renders a strays failure in place without blanking the console', async () => {
    routes({ 'GET /api/projects/p1/git/strays': { status: 500, body: { error: 'EACCES' } } })
    renderConsole()
    // The whole point of the separate route: the rest of the console survives.
    expect(await screen.findByLabelText('Branches')).toBeTruthy()
    expect(screen.getByText(/EACCES/)).toBeTruthy()
  })

  // A defect class already fixed once server-side for `fetch`/`push`
  // (commit f186053): `release` writes no `git_undo` row, so without an
  // explicit exclusion the console would raise an Undo banner after a
  // successful release — and clicking it would undo the *previous*
  // mutation under a label reading "Release".
  it('offers no undo after a release', async () => {
    routes({
      'POST /api/projects/p1/git/release': { body: { report: { describes: 'Released' } } },
    })
    renderConsole()
    const list = await screen.findByLabelText('Stray worktrees')
    const row = within(list).getAllByRole('listitem')[0] as HTMLElement

    await userEvent.click(within(row).getByRole('button'))
    await userEvent.click(within(row).getByRole('button'))
    await waitFor(() => expect(screen.getByText('Released')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})

it('says so when a repository has no remotes, instead of an empty heading', async () => {
  routes({ 'GET /api/projects/p1/git/remotes': { body: { remotes: [] } } })
  renderConsole()
  // A bare "Remotes" heading with nothing under it reads as broken rather
  // than as "none configured" — seen in a browser on 2026-08-25.
  expect(await screen.findByText(/no remotes/i)).toBeTruthy()
})

it('arms the two kinds with different weight, not just different words', async () => {
  routes()
  renderConsole()
  const list = await screen.findByLabelText('Stray worktrees')
  const rows = within(list).getAllByRole('listitem')

  await userEvent.click(within(rows[0] as HTMLElement).getByRole('button'))
  const vanishedArmed = within(rows[0] as HTMLElement).getByRole('button').className
  await userEvent.click(within(rows[1] as HTMLElement).getByRole('button'))
  const strandedArmed = within(rows[1] as HTMLElement).getByRole('button').className

  // Releasing a vanished row clears a database record and touches no file;
  // releasing a stranded one deletes a directory recursively. Both armed in
  // the same destructive red until this test — the words differed, the
  // signal did not, and the whole design rests on them costing different
  // things.
  // Asserted on the background token, not on the substring "destructive":
  // shadcn's base Button classes mention it in `aria-invalid:` variants
  // regardless of the chosen variant, so a substring check passes for both.
  expect(strandedArmed).toContain('bg-destructive')
  expect(vanishedArmed).not.toContain('bg-destructive')
  expect(vanishedArmed).toContain('bg-secondary')
})
