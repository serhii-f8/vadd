import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { FocusView } from '../src/routes/FocusView.js'
import { mockFetch } from './setup.js'

function aggregate(over: Record<string, unknown> = {}) {
  return {
    state: 'executing',
    tasks: [],
    decisions: [],
    evidence: [],
    lastAutoApproval: null,
    lastStatus: null,
    lastAgentUpdateAt: null,
    lastProblem: null,
    pendingClarification: null,
    ...over,
    objective: {
      id: 'o1',
      projectId: 'p1',
      title: 'Prove worktree write access',
      goalText: 'g',
      status: 'executing',
      worktreePath: '/tmp/wt',
      branchName: 'vadd/abc12345',
      baseSha: 'deadbeef',
      integrateAction: null,
      lowEnergy: false,
      mode: 'standard',
      updatedAt: '2026-08-23T10:00:00.000Z',
      ...(over.objective as Record<string, unknown> | undefined),
    },
  }
}

function task(ord: number, status: string, title: string, startedAt: string | null = null) {
  return {
    id: `t${ord}`,
    ord,
    title,
    description: 'd',
    status,
    expectFailing: null,
    startedAt,
    finishedAt: null,
    checkpointRef: null,
  }
}

function renderFocus() {
  return render(
    <MemoryRouter initialEntries={['/o/o1']}>
      <Routes>
        <Route path="/o/:id" element={<FocusView />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Focus View activity', () => {
  it("shows the agent's last status while it is working", async () => {
    mockFetch({
      'GET /api/objectives/o1': () => ({
        body: aggregate({
          tasks: [task(0, 'running', 'Create a scratch file')],
          lastStatus: { headline: 'Creating the scratch file', phase: 'executing', at: 'x' },
        }),
      }),
    })
    renderFocus()
    expect(await screen.findByText('Creating the scratch file')).toBeTruthy()
  })

  it('lists every plan task without a hover', async () => {
    mockFetch({
      'GET /api/objectives/o1': () => ({
        body: aggregate({
          tasks: [
            task(0, 'verified', 'Create a scratch file'),
            task(1, 'pending', 'Read the scratch file back'),
          ],
        }),
      }),
    })
    renderFocus()
    // The dot strip this replaces put both of these behind a tooltip.
    expect(await screen.findByText('Read the scratch file back')).toBeTruthy()
    expect(screen.getByText('Create a scratch file')).toBeTruthy()
  })

  it('hides the plan in Low Energy Mode, which is the point of the mode', async () => {
    mockFetch({
      'GET /api/objectives/o1': () => ({
        body: aggregate({
          objective: { lowEnergy: true },
          tasks: [task(0, 'pending', 'Read the scratch file back')],
        }),
      }),
    })
    renderFocus()
    await screen.findByRole('heading', { name: 'Prove worktree write access' })
    expect(screen.queryByText('Read the scratch file back')).toBeNull()
  })

  it('says why a paused objective stopped', async () => {
    mockFetch({
      'GET /api/objectives/o1': () => ({
        body: aggregate({
          state: 'paused',
          lastProblem: {
            type: 'verification_unresolved',
            message: null,
            at: '2026-08-23T10:25:23.044Z',
          },
        }),
      }),
    })
    renderFocus()
    // Twelve of these fired on a real objective and the paused screen showed
    // a Resume button and nothing else.
    expect(await screen.findByText('No verification spec could be resolved')).toBeTruthy()
  })

  it('does not report a stale problem while the agent is working', async () => {
    mockFetch({
      'GET /api/objectives/o1': () => ({
        body: aggregate({
          state: 'executing',
          lastProblem: {
            type: 'verification_unresolved',
            message: null,
            at: '2026-08-23T10:25:23.044Z',
          },
        }),
      }),
    })
    renderFocus()
    await screen.findByRole('heading', { name: 'Prove worktree write access' })
    // `lastProblem` is the newest problem *ever*, not a current one. A run
    // that has since recovered must not carry a red alert through it.
    expect(screen.queryByText('No verification spec could be resolved')).toBeNull()
  })
})
