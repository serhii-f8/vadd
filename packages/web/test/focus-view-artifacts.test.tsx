import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProjectsProvider } from '../src/app/ProjectsContext.js'
import { FocusView } from '../src/routes/FocusView.js'
import { mockFetch } from './setup.js'

// Copied verbatim from focus-view.test.tsx — not exported from that file.
function aggregate(over: Record<string, unknown> = {}) {
  return {
    state: 'idle',
    tasks: [],
    decisions: [],
    evidence: [],
    artifacts: [],
    lastAutoApproval: null,
    lastStatus: null,
    lastAgentUpdateAt: null,
    lastProblem: null,
    ...over,
    // `objective` is assigned last, deliberately after `...over`: `over` may
    // itself carry an `objective` key (every existing caller that overrides
    // a field on it does), and an object literal's later key always wins —
    // spreading `over` first and merging `objective` after is what makes the
    // merge below actually apply instead of being silently replaced by
    // whatever partial `over.objective` a caller passed.
    objective: {
      id: 'o1',
      projectId: 'p1',
      title: 'Fix the login redirect',
      goalText: 'g',
      status: 'idle',
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

function renderFocus() {
  return render(
    <MemoryRouter initialEntries={['/o/o1']}>
      {/* Task 8: the outcome branch always mounts a `NewObjectiveDialog`
          (closed, ready to seed a Continue), and that component reads
          `useProjects()` unconditionally — matching production, where
          `FocusView` is always rendered inside `App.tsx`'s own
          `ProjectsProvider`. */}
      <ProjectsProvider>
        <Routes>
          <Route path="/o/:id" element={<FocusView />} />
        </Routes>
      </ProjectsProvider>
    </MemoryRouter>,
  )
}

const decision = {
  id: 'd1',
  question: 'Queue or inline?',
  recommendedId: 'q',
  chosenId: null,
  options: [
    { id: 'q', label: 'Queue', pros: [], cons: [], reversibility: 'high', verification: 'v' },
    { id: 'i', label: 'Inline', pros: [], cons: [], reversibility: 'high', verification: 'v' },
  ],
}
const artifact = (state: string) => ({
  id: 'a1',
  state,
  createdAt: '2026-09-02T10:00:00.000Z',
  cards: [{ id: 'why', kind: 'text', title: 'Why a queue', body: 'Requests time out.' }],
})
const task = {
  id: 't0',
  ord: 0,
  title: 'Add a test',
  description: 'd',
  status: 'pending',
  expectFailing: null,
  startedAt: null,
  finishedAt: null,
  checkpointRef: null,
}

describe('FocusView artifact mount (A24 §3.7)', () => {
  it('shows the propose artifact beneath the Decision Card', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingDecision',
          decisions: [decision],
          artifacts: [artifact('proposing')],
        }),
      },
    })
    renderFocus()
    const question = await screen.findByText('Queue or inline?')
    const card = screen.getByText('Requests time out.')
    // Beneath: the card comes later in document order than the decision.
    expect(question.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the plan artifact beneath Plan Approval', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingPlanApproval',
          tasks: [task],
          artifacts: [artifact('planning')],
        }),
      },
    })
    renderFocus()
    expect(await screen.findByText('Requests time out.')).toBeTruthy()
  })

  it('shows no artifact under any other primary element, even when rows exist', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingReview',
          artifacts: [artifact('proposing'), artifact('planning')],
        }),
      },
    })
    renderFocus()
    await screen.findByText(/awaitingReview/)
    expect(screen.queryByText('Requests time out.')).toBeNull()
  })

  it('collapses the cards when Low Energy Mode is on', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingDecision',
          decisions: [decision],
          artifacts: [artifact('proposing')],
          objective: { lowEnergy: true },
        }),
      },
    })
    renderFocus()
    expect(await screen.findByText('Why a queue')).toBeTruthy()
    expect(screen.queryByText('Requests time out.')).toBeNull()
  })
})
