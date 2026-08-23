import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
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
})
