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
            <Route path="/today" element={<p>today page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  })

  it('renders navigation to both destinations', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    expect(await screen.findByRole('link', { name: 'Objectives' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Today' })).toBeTruthy()
  })

  it('marks the active route', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell('/today')
    const today = await screen.findByRole('link', { name: 'Today' })
    expect(today.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Objectives' }).getAttribute('aria-current')).toBe(null)
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

  it('renders the shell even when the project fetch fails', async () => {
    mockFetch({ 'GET /api/projects': { status: 500, body: { error: 'db is down' } } })
    renderShell()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Objectives' })).toBeTruthy()
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

    expect(await screen.findByText('Fix the login redirect')).toBeTruthy()

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Project' }))
    const option = await screen.findByRole('option', { name: 'vadd' })
    await user.click(option)

    expect(await screen.findByText('Wire the ACP adapter')).toBeTruthy()
    expect(screen.queryByText('Fix the login redirect')).toBeNull()
  })
})
