import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { FocusView } from '../src/routes/FocusView.js'
import { FakeEventSource, mockFetch } from './setup.js'

function aggregate(over: Record<string, unknown> = {}) {
  return {
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
    },
    state: 'idle',
    tasks: [],
    decisions: [],
    evidence: [],
    ...over,
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

describe('FocusView mirroring (spec §7: no client-side transitions)', () => {
  it('refetches the aggregate on an SSE event and shows the new state', async () => {
    let state = 'planning'
    mockFetch({ 'GET /api/objectives/o1': () => ({ body: aggregate({ state }) }) })
    renderFocus()
    expect(await screen.findByText(/planning/)).toBeTruthy()

    state = 'awaitingPlanApproval'
    FakeEventSource.instances[0]?.push({ id: 1, objectiveId: 'o1', type: 'agent_event' })
    await waitFor(() => expect(screen.getByText(/awaitingPlanApproval/)).toBeTruthy())
  })

  it('opens the SSE stream scoped to this objective', async () => {
    mockFetch({ 'GET /api/objectives/o1': { body: aggregate() } })
    renderFocus()
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    expect(FakeEventSource.instances[0]?.url).toContain('objectiveId=o1')
  })

  it('shows a refused command and does NOT advance the view', async () => {
    mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'executing' }) },
      'POST /api/objectives/o1/events': {
        status: 409,
        body: { error: 'Command "pause" is not accepted in state "executing"' },
      },
    })
    renderFocus()
    await screen.findByText(/executing/)
    await userEvent.click(screen.getByRole('button', { name: /pause/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('is not accepted in state'),
    )
    // The refusal is visible AND names the state, verbatim from the server —
    // the view mirrors the server, it does not predict it.
    expect(within(screen.getByRole('alert')).getByText(/executing/)).toBeTruthy()
  })
})

describe('FocusView primary element by state', () => {
  it('shows the decision options as a radio list in awaitingDecision', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingDecision',
          decisions: [
            {
              id: 'd1',
              question: 'Which fix?',
              recommendedId: 'b',
              chosenId: null,
              options: [
                {
                  id: 'a',
                  label: 'Patch the guard',
                  pros: ['small'],
                  cons: ['narrow'],
                  reversibility: 'high',
                  verification: 'run the suite',
                },
                {
                  id: 'b',
                  label: 'Rework the middleware',
                  pros: ['general'],
                  cons: ['bigger'],
                  reversibility: 'medium',
                  verification: 'run the suite',
                },
              ],
            },
          ],
        }),
      },
    })
    renderFocus()
    expect(await screen.findByText('Which fix?')).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    // §4's only mandatory analysis field is always visible.
    expect(screen.getByText(/high/)).toBeTruthy()
    expect(screen.getByText(/medium/)).toBeTruthy()
  })

  it('preselects the recommended option', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingDecision',
          decisions: [
            {
              id: 'd1',
              question: 'Which fix?',
              recommendedId: 'b',
              chosenId: null,
              options: [
                {
                  id: 'a',
                  label: 'A',
                  pros: [],
                  cons: [],
                  reversibility: 'high',
                  verification: 'v',
                },
                {
                  id: 'b',
                  label: 'B',
                  pros: [],
                  cons: [],
                  reversibility: 'low',
                  verification: 'v',
                },
              ],
            },
          ],
        }),
      },
    })
    renderFocus()
    const radios = (await screen.findAllByRole('radio')) as HTMLInputElement[]
    expect(radios[1]?.checked).toBe(true)
  })

  it('posts decide with the chosen option', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingDecision',
          decisions: [
            {
              id: 'd1',
              question: 'Which fix?',
              recommendedId: 'b',
              chosenId: null,
              options: [
                {
                  id: 'a',
                  label: 'A',
                  pros: [],
                  cons: [],
                  reversibility: 'high',
                  verification: 'v',
                },
                {
                  id: 'b',
                  label: 'B',
                  pros: [],
                  cons: [],
                  reversibility: 'low',
                  verification: 'v',
                },
              ],
            },
          ],
        }),
      },
      'POST /api/objectives/o1/events': { status: 202, body: { ok: true } },
    })
    renderFocus()
    await userEvent.click(await screen.findByRole('radio', { name: /A/ }))
    await userEvent.click(screen.getByRole('button', { name: /choose/i }))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      type: 'decide',
      decisionId: 'd1',
      optionId: 'a',
    })
  })

  it('shows the plan as an editable list in awaitingPlanApproval', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingPlanApproval',
          tasks: [
            {
              id: 't1',
              ord: 0,
              title: 'Write the failing test',
              description: 'd',
              status: 'pending',
            },
            { id: 't2', ord: 1, title: 'Fix the guard', description: 'd', status: 'pending' },
          ],
        }),
      },
    })
    renderFocus()
    expect(await screen.findByDisplayValue('Write the failing test')).toBeTruthy()
    expect(screen.getByRole('button', { name: /approve plan/i })).toBeTruthy()
  })

  it('shows a live card with no log stream while the agent works', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'executing',
          tasks: [
            { id: 't1', ord: 0, title: 'Fix the guard', description: 'd', status: 'running' },
          ],
        }),
      },
    })
    renderFocus()
    expect(await screen.findByText('Fix the guard')).toBeTruthy()
    expect(screen.queryByTestId('log-stream')).toBeNull()
  })

  it('offers the integration chooser only in integrating', async () => {
    mockFetch({ 'GET /api/objectives/o1': { body: aggregate({ state: 'integrating' }) } })
    renderFocus()
    for (const name of [/commit/i, /keep/i, /discard/i]) {
      expect(await screen.findByRole('button', { name })).toBeTruthy()
    }
  })

  it('posts the chosen integration action', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'integrating' }) },
      'POST /api/objectives/o1/events': { status: 202, body: { ok: true } },
    })
    renderFocus()
    await userEvent.click(await screen.findByRole('button', { name: /^commit/i }))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      type: 'integrate',
      action: 'commit',
    })
  })

  it('offers abandon, not the machine-less cancel, in the header', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'executing' }) },
      'POST /api/objectives/o1/events': { status: 202, body: { ok: true } },
    })
    renderFocus()
    await userEvent.click(await screen.findByRole('button', { name: /abandon/i }))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ type: 'abandon' })
  })

  it('shows the outcome read-only in a terminal state', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'done',
          objective: { ...aggregate().objective, status: 'done', integrateAction: 'commit' },
        }),
      },
    })
    renderFocus()
    expect(await screen.findByText(/commit/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /abandon/i })).toBeNull()
  })
})
