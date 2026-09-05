import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProjectsProvider } from '../src/app/ProjectsContext.js'
import { GitStrip } from '../src/focus/GitStrip.js'
import { FocusView } from '../src/routes/FocusView.js'
import { mockFetch } from './setup.js'

/**
 * The Focus View's git subset is deliberately small: stage/discard, commit
 * and undo, for the current objective only. Spec §8 fixes one primary element
 * per state, and the Focus View is not becoming a git client — the branch
 * strip Pass A added already links through to `/git` for everything else.
 */
describe('GitStrip', () => {
  const PERMITTED = { projectId: 'p1', worktreePath: '/wt', status: 'paused' as const }

  it('offers commit in a permitted state', () => {
    render(<GitStrip {...PERMITTED} undoable={null} onDone={vi.fn()} />)
    expect(screen.getByRole('button', { name: /commit/i })).toBeTruthy()
  })

  it('replaces the controls with the gate reason in a busy state', () => {
    render(<GitStrip {...PERMITTED} status="executing" undoable={null} onDone={vi.fn()} />)
    // The reason names the state, not just "unavailable": the user has to
    // know it is their own agent in the way, and that Pause is the answer.
    expect(screen.getByText(/executing/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /commit/i })).toBeNull()
  })

  it('shows the undo banner only when there is a record', () => {
    const { rerender } = render(<GitStrip {...PERMITTED} undoable={null} onDone={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()

    rerender(<GitStrip {...PERMITTED} undoable="Commit staged changes" onDone={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(screen.getByText('Commit staged changes')).toBeTruthy()
  })

  it('does not commit on a single unconfirmed click', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<GitStrip {...PERMITTED} undoable={null} onDone={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^commit/i }))
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

/**
 * Where the Focus View mounts the strip at all — a separate question from
 * what the strip does once mounted, and the one spec §8's "one primary
 * element per state" actually governs.
 */
describe('FocusView: where the git subset appears', () => {
  function aggregate(over: Record<string, unknown> = {}) {
    return {
      state: 'paused',
      tasks: [],
      decisions: [],
      evidence: [],
      artifacts: [],
      lastAutoApproval: null,
      lastStatus: null,
      lastAgentUpdateAt: null,
      lastProblem: null,
      ...over,
      objective: {
        id: 'o1',
        projectId: 'p1',
        title: 'Fix the login redirect',
        goalText: 'g',
        status: 'paused',
        worktreePath: '/tmp/wt',
        branchName: 'vadd/abc12345',
        baseSha: 'deadbeef',
        integrateAction: null,
        lowEnergy: false,
        mode: 'standard',
        ...(over.objective as Record<string, unknown> | undefined),
      },
    }
  }

  function renderFocus(agg: unknown) {
    mockFetch({
      'GET /api/objectives/o1': { body: agg },
      'GET /api/projects': { body: [] },
    })
    // The Focus View derives the shell's project from its objective, which
    // needs the provider — as in production, where `AppShell` supplies it.
    return render(
      <MemoryRouter initialEntries={['/o/o1']}>
        <ProjectsProvider>
          <Routes>
            <Route path="/o/:id" element={<FocusView />} />
          </Routes>
        </ProjectsProvider>
      </MemoryRouter>,
    )
  }

  it('offers the controls on a stopped objective', async () => {
    renderFocus(aggregate({ state: 'paused' }))
    expect(await screen.findByRole('button', { name: /commit staged/i })).toBeTruthy()
  })

  it('offers nothing in a state that is not busy but is not a git state either', async () => {
    // `awaitingDecision` deliberately: it is neither in GIT_STATES nor in
    // GitStrip's own busy map, so it is the only kind of state where the
    // mount rule is the *sole* thing deciding. A busy state like `executing`
    // would prove nothing here — GitStrip refuses that one itself, so the
    // assertion holds whether the mount rule exists or not.
    renderFocus(aggregate({ state: 'awaitingDecision' }))
    // Waited for, not asserted on an empty first render: the aggregate
    // arrives asynchronously, so a bare queryBy would pass before anything
    // had rendered at all.
    expect(await screen.findByText('Fix the login redirect')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /commit staged/i })).toBeNull()
  })

  it('offers nothing once the worktree is gone, even in a git state', async () => {
    // `paused` is in GIT_STATES, so only the worktree guard can suppress the
    // strip here. With `done` — outside GIT_STATES — the state rule would
    // suppress it anyway and the worktree guard would go untested.
    renderFocus(aggregate({ state: 'paused', objective: { worktreePath: null } }))
    expect(await screen.findByText('Fix the login redirect')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /commit staged/i })).toBeNull()
  })

  it('still refuses inside the strip if a busy objective ever reaches it', async () => {
    // GitStrip's own busy map is defence in depth behind the mount rule, and
    // is pinned by its own unit tests above; this records that the two are
    // separate rules, not one.
    renderFocus(aggregate({ state: 'executing' }))
    expect(await screen.findByText('Fix the login redirect')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /commit staged/i })).toBeNull()
  })
})
