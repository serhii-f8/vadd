import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProjectsProvider } from '../src/app/ProjectsContext.js'
import { GitConsole } from '../src/routes/GitConsole.js'
import { mockFetch } from './setup.js'

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
      owner: { kind: 'user' },
    },
    {
      name: 'vadd/fdca5ca3',
      sha: 'b'.repeat(40),
      isCurrent: false,
      upstream: null,
      owner: {
        kind: 'vadd',
        objectiveId: 'o1',
        objectiveTitle: 'Prove worktree write access',
        objectiveStatus: 'paused',
      },
    },
    {
      name: 'vadd/deadbeef',
      sha: 'c'.repeat(40),
      isCurrent: false,
      upstream: null,
      owner: { kind: 'orphan' },
    },
  ],
  worktrees: [
    {
      path: '/var/www/vadd',
      branch: 'master',
      head: 'a'.repeat(40),
      isMain: true,
      locked: false,
      prunable: false,
      owner: { kind: 'user' },
    },
    {
      path: '/home/u/.vadd/worktrees/p1/orphaned',
      branch: null,
      head: 'c'.repeat(40),
      isMain: false,
      locked: false,
      prunable: true,
      owner: { kind: 'orphan' },
    },
  ],
}

const log = {
  commits: [
    {
      sha: 'a'.repeat(40),
      parents: ['d'.repeat(40)],
      subject: 'feat: the map',
      author: 'S',
      at: '2026-08-23T10:00:00Z',
      refs: ['master'],
    },
    {
      sha: 'd'.repeat(40),
      parents: [],
      subject: 'init',
      author: 'S',
      at: '2026-08-22T10:00:00Z',
      refs: [],
    },
  ],
  hasMore: false,
}

const pagedLog = {
  commits: [
    {
      sha: 'a'.repeat(40),
      parents: ['e'.repeat(40)],
      subject: 'feat: the map',
      author: 'S',
      at: '2026-08-23T10:00:00Z',
      refs: ['master'],
    },
    {
      sha: 'e'.repeat(40),
      parents: ['d'.repeat(40)],
      subject: 'second commit',
      author: 'S',
      at: '2026-08-22T12:00:00Z',
      refs: [],
    },
  ],
  hasMore: true,
}

const olderLog = {
  commits: [
    {
      sha: 'd'.repeat(40),
      parents: [],
      subject: 'init',
      author: 'S',
      at: '2026-08-22T10:00:00Z',
      refs: [],
    },
  ],
  hasMore: false,
}

function renderConsole() {
  return render(
    <MemoryRouter initialEntries={['/git?project=p1']}>
      <ProjectsProvider>
        <Routes>
          <Route path="/git" element={<GitConsole />} />
        </Routes>
      </ProjectsProvider>
    </MemoryRouter>,
  )
}

describe('GitConsole', () => {
  it('lists branches, worktrees and history', async () => {
    mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { body: topology },
      'GET /api/projects/p1/git/log': { body: log },
    })
    renderConsole()
    expect(await screen.findByText('vadd/fdca5ca3')).toBeTruthy()
    // 'master' legitimately renders three times at once (the worktree's
    // branch column, the branch list's own row, and the commit's ref badge)
    // — scope to the Branches list, which is what this assertion means to
    // check, rather than the ambiguous whole-page query the brief's own test
    // used.
    const branchesList = screen.getByRole('list', { name: 'Branches' })
    expect(within(branchesList).getByText('master')).toBeTruthy()
    expect(screen.getByText('feat: the map')).toBeTruthy()
  })

  it('links a VADD-owned branch to its objective', async () => {
    mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { body: topology },
      'GET /api/projects/p1/git/log': { body: log },
    })
    renderConsole()
    const link = await screen.findByRole('link', { name: /Prove worktree write access/ })
    expect(link.getAttribute('href')).toBe('/o/o1')
  })

  it('calls out an orphaned worktree with its path', async () => {
    mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { body: topology },
      'GET /api/projects/p1/git/log': { body: log },
    })
    renderConsole()
    // The whole point: this repo has leaked ten of these and nothing has ever
    // shown one. The path must be readable so it can be acted on.
    expect(await screen.findByText('/home/u/.vadd/worktrees/p1/orphaned')).toBeTruthy()
    const row = screen.getByText('/home/u/.vadd/worktrees/p1/orphaned').closest('li')
    // Exact match, not the brief's own `/orphan/i` regex: the path itself is
    // "...p1/orphaned", which also contains "orphan" as a substring and the
    // regex matches it too, colliding with the OwnerBadge text this assertion
    // means to find.
    expect(within(row as HTMLElement).getByText('orphan')).toBeTruthy()
  })

  it('shows the server error rather than a blank page', async () => {
    mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { status: 500, body: { error: 'not a git repository' } },
      'GET /api/projects/p1/git/log': { body: log },
    })
    renderConsole()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('not a git repository'),
    )
  })

  it('refetches on demand, because git changes from outside VADD', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { body: topology },
      'GET /api/projects/p1/git/log': { body: log },
    })
    renderConsole()
    await screen.findByText('vadd/fdca5ca3')
    const before = calls.filter((c) => c.url.endsWith('/git')).length

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/git')).length).toBe(before + 1))
  })

  it('has no load-more control when there is nothing older', async () => {
    mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { body: topology },
      'GET /api/projects/p1/git/log': { body: log },
    })
    renderConsole()
    await screen.findByText('feat: the map')
    expect(screen.queryByRole('button', { name: /load 50 more/i })).toBeNull()
  })

  it('shows a load-more control when there is older history, fetches the next page by the last loaded sha, and appends rather than replaces', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { body: topology },
      'GET /api/projects/p1/git/log?limit=50': { body: pagedLog },
      [`GET /api/projects/p1/git/log?before=${'e'.repeat(40)}&limit=50`]: { body: olderLog },
    })
    renderConsole()
    await screen.findByText('second commit')

    const loadMore = screen.getByRole('button', { name: /load 50 more/i })
    await userEvent.click(loadMore)

    // Appended, not replaced: the first page's commits are still on screen
    // alongside the newly fetched older page.
    await screen.findByText('init')
    expect(screen.getByText('feat: the map')).toBeTruthy()
    expect(screen.getByText('second commit')).toBeTruthy()

    expect(calls.some((c) => c.url.includes(`before=${'e'.repeat(40)}`))).toBe(true)
    // olderLog's own hasMore is false — the control must not survive past it.
    expect(screen.queryByRole('button', { name: /load 50 more/i })).toBeNull()
  })

  it('degrades the History region on a bad ref without losing the topology', async () => {
    // A stale or wrong `?ref=` — a bookmark, or a branch strip link into the
    // wrong project (Item 1) — must not take the whole page down with it.
    // `readLog`'s own guard produces a 400 with this exact message.
    mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { body: topology },
      'GET /api/projects/p1/git/log': {
        status: 400,
        body: { error: 'Not a branch of this repository: nope' },
      },
    })
    render(
      <MemoryRouter initialEntries={['/git?project=p1&ref=nope']}>
        <ProjectsProvider>
          <Routes>
            <Route path="/git" element={<GitConsole />} />
          </Routes>
        </ProjectsProvider>
      </MemoryRouter>,
    )
    // Worktrees and branches still render — the topology fetch never failed.
    expect(await screen.findByText('vadd/fdca5ca3')).toBeTruthy()
    expect(screen.getByText('/home/u/.vadd/worktrees/p1/orphaned')).toBeTruthy()
    // The log's own error is shown in place of the History region, not as a
    // page-level alert that also hides the two sections above it.
    expect(screen.getByText('Not a branch of this repository: nope')).toBeTruthy()
    expect(screen.queryByText('feat: the map')).toBeNull()
  })

  it('shows an upstream branch alongside its name', async () => {
    const withUpstream = {
      ...topology,
      branches: [
        { ...topology.branches[0], upstream: 'origin/master' },
        ...topology.branches.slice(1),
      ],
    }
    mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { body: withUpstream },
      'GET /api/projects/p1/git/log': { body: log },
    })
    renderConsole()
    expect(await screen.findByText('origin/master', { exact: false })).toBeTruthy()
  })

  it('discards a stale loadMore response that resolves after a fresh load() has already replaced the page', async () => {
    // The exact race from Item 4: "Load 50 more" starts a fetch for an
    // older page, held open; a `load()` (here, the "Refresh" button, the
    // same trigger the real window-focus handler uses) fires and resolves
    // first, replacing `commits` with a freshly fetched page 1. Only then
    // does the held-open older-page fetch resolve. Without the generation
    // guard, its `[...prev, ...l.commits]` append lands on top of the fresh
    // page 1 regardless of how stale it is — this is what
    // `screen.queryByText('init')` pins: `init` exists only in `olderLog`,
    // the response the guard must discard.
    let releaseOlder = (): void => {}
    const olderGate = new Promise<void>((resolve) => {
      releaseOlder = resolve
    })
    const calls: Array<{ url: string }> = []
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push({ url })
      const pathname = new URL(url, 'http://localhost').pathname
      const respond = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (pathname === '/api/projects') return respond(projects)
      if (pathname === '/api/projects/p1/git') return respond(topology)
      if (pathname === '/api/projects/p1/git/log') {
        if (url.includes('before=')) {
          await olderGate
          return respond(olderLog)
        }
        return respond(pagedLog)
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    renderConsole()
    await screen.findByText('second commit')

    await userEvent.click(screen.getByRole('button', { name: /load 50 more/i }))
    // loadMore's fetch is now in flight, gated on `olderGate`.
    await waitFor(() => expect(calls.some((c) => c.url.includes('before='))).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))
    // load()'s own log fetch (no `before=`) resolves immediately, so the
    // page is back to a fresh copy of `pagedLog` before the stale response
    // is released below.
    await waitFor(() => expect(screen.getAllByText('second commit')).toHaveLength(1))

    releaseOlder()
    // Give the (would-be) stale append a real chance to land before asserting
    // it did not.
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByText('init')).toBeNull()
    expect(screen.getAllByText('second commit')).toHaveLength(1)
  })

  it('guards loadMore against a double click racing the same page', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/projects/p1/git': { body: topology },
      'GET /api/projects/p1/git/log?limit=50': { body: pagedLog },
      [`GET /api/projects/p1/git/log?before=${'e'.repeat(40)}&limit=50`]: { body: olderLog },
    })
    renderConsole()
    await screen.findByText('second commit')

    const loadMoreBtn = screen.getByRole('button', { name: /load 50 more/i })
    // Two clicks fired back to back, synchronously, before the first fetch
    // settles — `fireEvent` (unlike `userEvent`) dispatches synchronously
    // with no delay between them, which is what actually reproduces the
    // race: both onClick handlers run before either fetch has resolved.
    fireEvent.click(loadMoreBtn)
    fireEvent.click(loadMoreBtn)

    // Tolerant of a duplicate render while waiting for the fetch(es) to
    // settle — the assertions below are what actually pin the behaviour.
    await waitFor(() => expect(screen.queryAllByText('init').length).toBeGreaterThan(0))

    const beforeCalls = calls.filter((c) => c.url.includes(`before=${'e'.repeat(40)}`))
    expect(beforeCalls).toHaveLength(1)
    expect(screen.getAllByText('init')).toHaveLength(1)
  })
})
