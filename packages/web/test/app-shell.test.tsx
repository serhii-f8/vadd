import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../src/app/AppShell.js'
import { useProjects } from '../src/app/ProjectsContext.js'
import { ThemeProvider } from '../src/app/ThemeProvider.js'
import { ObjectiveList } from '../src/routes/ObjectiveList.js'
import { mockFetch } from './setup.js'

const projects = [
  {
    id: 'p1',
    name: 'flexpick.net',
    repoPath: '/var/www/flexpick',
    config: {},
    agentKind: 'claude-code',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'p2',
    name: 'vadd',
    repoPath: '/var/www/vadd',
    config: {},
    agentKind: 'codex',
    createdAt: '2026-08-02T00:00:00.000Z',
  },
]

function Probe() {
  const { selected } = useProjects()
  return <span data-testid="selected">{selected?.name ?? 'none'}</span>
}

function renderShell(initial = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Probe />} />
            <Route path="/today" element={<Probe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    // Query-aware: the shell picks its layout from `(min-width: …)` queries,
    // and these tests describe the full-sidebar layout unless they say so.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    localStorage.clear()
  })

  it('renders navigation to all destinations', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    expect(await screen.findByRole('link', { name: /^Objectives/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Today' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Map' })).toBeTruthy()
  })

  it('marks the active route', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell('/today')
    const today = await screen.findByRole('link', { name: 'Today' })
    expect(today.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /^Objectives/ }).getAttribute('aria-current')).toBe(
      null,
    )
  })

  it('defaults the selection to the first project', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    expect((await screen.findByTestId('selected')).textContent).toBe('flexpick.net')
  })

  it('honours ?project= over the default', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell('/?project=p2')
    expect((await screen.findByTestId('selected')).textContent).toBe('vadd')
  })

  // Found by driving the app live in a real browser (2026-08-27): the sidebar's
  // own NAV links are static hrefs with no `?project=`, so a non-default
  // selection survives only until the next click on Today/Map/Git — which
  // silently drops the user back onto the first-registered project with no
  // indication anything changed. This is the same class of bug the Focus
  // View's branch link was fixed for, just never closed at the source.
  it('keeps a non-default project selected across a sidebar nav click', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell('/?project=p2')
    expect((await screen.findByTestId('selected')).textContent).toBe('vadd')

    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: 'Today' }))

    expect((await screen.findByTestId('selected')).textContent).toBe('vadd')
  })

  it('renders the shell even when the project fetch fails', async () => {
    mockFetch({ 'GET /api/projects': { status: 500, body: { error: 'db is down' } } })
    renderShell()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Objectives/ })).toBeTruthy()
  })

  it('disables New objective until a project exists', async () => {
    mockFetch({ 'GET /api/projects': { body: [] } })
    renderShell()
    const button = await screen.findByRole('button', { name: /New objective/ })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('enables New objective once a project exists', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    const button = await screen.findByRole('button', { name: /New objective/ })
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('shows how many objectives need you on the Objectives entry', async () => {
    mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/objectives': {
        body: [
          {
            id: 'o1',
            projectId: 'p1',
            title: 'Decide',
            status: 'awaitingDecision',
            worktreePath: null,
            branchName: null,
            integrateAction: null,
            updatedAt: '2026-09-05T10:00:00.000Z',
            verifiedCount: 0,
            totalCount: 0,
          },
          {
            id: 'o2',
            projectId: 'p1',
            title: 'Run',
            status: 'executing',
            worktreePath: null,
            branchName: null,
            integrateAction: null,
            updatedAt: '2026-09-05T10:00:00.000Z',
            verifiedCount: 0,
            totalCount: 0,
          },
        ],
      },
    })
    renderShell()
    expect(await screen.findByRole('link', { name: /^Objectives.*1 needs you/ })).toBeTruthy()
    // And the running one is in Working now, from this screen.
    expect(screen.getByRole('link', { name: /Run/ }).getAttribute('href')).toBe('/o/o2')
  })

  it('renders a top bar below md and opens the sidebar in a drawer', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    const open = await screen.findByRole('button', { name: 'Open navigation' })
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull()
    await userEvent.click(open)
    expect(await screen.findByRole('combobox', { name: 'Project' })).toBeTruthy()
  })

  it('mounts the theme control', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    expect(await screen.findByRole('button', { name: /Theme:/ })).toBeTruthy()
  })

  // The single test the whole shell refactor exists for: driving the real
  // shadcn/Radix Select in the Sidebar, by hand, end to end, and watching a
  // real page's content narrow in response — not calling `select()` from
  // context directly, which is the shortcut that hid this gap in the first
  // place (see ObjectiveList's own "narrows the board" test).
  it('narrows a real page when the sidebar Select is driven by hand', async () => {
    // jsdom implements neither of these, and Radix Select's pointer-capture
    // handling throws without them on open/select — see the task-8 report
    // for what plain `userEvent.click` did before this polyfill was added.
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()

    mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/objectives': {
        body: [
          {
            id: 'o1',
            projectId: 'p1',
            title: 'Fix the login redirect',
            status: 'executing',
            worktreePath: '/tmp/wt1',
            branchName: 'vadd/abc1',
            integrateAction: null,
            verifiedCount: 1,
            totalCount: 3,
          },
        ],
      },
      'GET /api/objectives?projectId=p2': {
        body: [
          {
            id: 'o2',
            projectId: 'p2',
            title: 'Wire the ACP adapter',
            status: 'executing',
            worktreePath: '/tmp/wt2',
            branchName: 'vadd/abc2',
            integrateAction: null,
            verifiedCount: 0,
            totalCount: 1,
          },
        ],
      },
    })

    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<ObjectiveList />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )

    // An executing objective now shows twice on purpose — the board row and
    // the sidebar's Working now — so the assertion is "present", not "once".
    expect((await screen.findAllByText('Fix the login redirect')).length).toBeGreaterThan(0)

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Project' }))
    const option = await screen.findByRole('option', { name: 'vadd' })
    await user.click(option)

    expect((await screen.findAllByText('Wire the ACP adapter')).length).toBeGreaterThan(0)
    expect(screen.queryAllByText('Fix the login redirect')).toHaveLength(0)
  })
})
